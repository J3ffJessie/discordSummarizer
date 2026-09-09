const {
  execute,
  runTestCases,
  buildHarness,
  inferType,
  RUNTIMES,
} = require('../codeExecutionService');

function mockFetchOnce(response, { ok = true, status = 200 } = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(response),
    text: jest.fn().mockResolvedValue(JSON.stringify(response)),
  });
}

function encode(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

const ACCEPTED = { id: 3, description: 'Accepted' };
const RUNTIME_ERROR = { id: 4, description: 'Runtime Error' };
const COMPILATION_ERROR = { id: 6, description: 'Compilation Error' };

describe('codeExecutionService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  // ── execute ───────────────────────────────────────────────────────────────

  describe('execute', () => {
    it('should return stdout/stderr/code from a successful run', async () => {
      mockFetchOnce({ status: ACCEPTED, stdout: encode('hello\n'), stderr: null, compile_output: null });

      const result = await execute({ language_id: 93, code: 'console.log("hi")' });

      expect(result).toEqual({ stdout: 'hello\n', stderr: '', code: 0 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/submissions'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should send the language_id and base64-encoded source/stdin', async () => {
      mockFetchOnce({ status: ACCEPTED, stdout: encode(''), stderr: null, compile_output: null });

      await execute({ language_id: 92, code: 'print(1)', stdin: 'input' });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body).toEqual({
        source_code: encode('print(1)'),
        language_id: 92,
        stdin: encode('input'),
      });
    });

    it('should throw when the HTTP response is not ok', async () => {
      mockFetchOnce({ message: 'bad request' }, { ok: false, status: 400 });
      await expect(execute({ language_id: 93, code: 'x' }))
        .rejects.toThrow('Judge0 returned 400');
    });

    it('should return compile output as stderr when compilation fails', async () => {
      mockFetchOnce({
        status: COMPILATION_ERROR,
        compile_output: encode('error: expected \';\''),
        stdout: null,
        stderr: null,
      });

      const result = await execute({ language_id: 54, code: 'int main() {' });

      expect(result.stderr).toBe('error: expected \';\'');
      expect(result.code).toBe(1);
    });

    it('should wrap a network failure in a descriptive error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(execute({ language_id: 93, code: 'x' }))
        .rejects.toThrow('Judge0 request failed: ECONNREFUSED');
    });
  });

  // ── inferType ─────────────────────────────────────────────────────────────

  describe('inferType', () => {
    it('should infer int for whole numbers', () => {
      expect(inferType(5)).toBe('int');
    });

    it('should infer double for non-whole numbers', () => {
      expect(inferType(5.5)).toBe('double');
    });

    it('should infer string for strings', () => {
      expect(inferType('hi')).toBe('string');
    });

    it('should infer bool for booleans', () => {
      expect(inferType(true)).toBe('bool');
    });

    it('should infer array element type with [] suffix', () => {
      expect(inferType([1, 2, 3])).toBe('int[]');
      expect(inferType(['a', 'b'])).toBe('string[]');
    });

    it('should default empty arrays to int[]', () => {
      expect(inferType([])).toBe('int[]');
    });

    it('should throw for unsupported value types', () => {
      expect(() => inferType({ a: 1 })).toThrow('Unsupported test-case value type');
    });
  });

  // ── buildHarness dispatch ────────────────────────────────────────────────

  describe('buildHarness', () => {
    const testCases = [{ input: [[2, 7, 11, 15], 9], expected: [0, 1] }];

    it('should throw for an unsupported language', () => {
      expect(() => buildHarness('ruby', 'code', testCases, 'twoSum')).toThrow('Unsupported code language');
    });

    it('should embed base64-encoded test cases and the marker for javascript', () => {
      const harness = buildHarness('javascript', 'function twoSum(nums, target) {}', testCases, 'twoSum');
      const encoded = Buffer.from(JSON.stringify(testCases), 'utf-8').toString('base64');
      expect(harness).toContain(encoded);
      expect(harness).toContain('__RESULTS__');
      expect(harness).toContain('twoSum(...tc.input)');
    });

    it('should embed base64-encoded test cases and the marker for python', () => {
      const harness = buildHarness('python', 'def two_sum(nums, target):\n    pass', testCases, 'two_sum');
      const encoded = Buffer.from(JSON.stringify(testCases), 'utf-8').toString('base64');
      expect(harness).toContain(encoded);
      expect(harness).toContain('__RESULTS__');
      expect(harness).toContain('two_sum(*tc[\'input\'])');
    });

    it('should generate typed literal calls for java', () => {
      const harness = buildHarness('java', 'class Solution {\n  public int[] twoSum(int[] nums, int target) { return null; }\n}', testCases, 'twoSum');
      expect(harness).toContain('new int[]{2, 7, 11, 15}');
      expect(harness).toContain('sol.twoSum(');
      expect(harness).toContain('java.util.Arrays.equals');
      expect(harness).toContain('__RESULTS__');
    });

    it('should generate typed literal calls for cpp', () => {
      const harness = buildHarness('cpp', 'class Solution {\npublic:\n    vector<int> twoSum(vector<int> nums, int target) { return {}; }\n};', testCases, 'twoSum');
      expect(harness).toContain('{2, 7, 11, 15}');
      expect(harness).toContain('sol.twoSum(');
      expect(harness).toContain('__RESULTS__');
    });
  });

  // ── runTestCases ──────────────────────────────────────────────────────────

  describe('runTestCases', () => {
    const testCases = [
      { input: [[2, 7, 11, 15], 9], expected: [0, 1] },
      { input: [[3, 3], 6], expected: [0, 1] },
    ];

    it('should throw for an unsupported code language', async () => {
      await expect(runTestCases('code', 'ruby', testCases, 'twoSum')).rejects.toThrow('Unsupported code language');
    });

    it('should return parsed pass/fail results and a correct pass count', async () => {
      const resultsPayload = [
        { pass: true, actual: [0, 1], expected: [0, 1] },
        { pass: false, actual: [1, 2], expected: [0, 1] },
      ];
      mockFetchOnce({ status: ACCEPTED, stdout: encode(`__RESULTS__${JSON.stringify(resultsPayload)}`), stderr: null, compile_output: null });

      const result = await runTestCases('function twoSum() {}', 'javascript', testCases, 'twoSum');

      expect(result.total).toBe(2);
      expect(result.passCount).toBe(1);
      expect(result.results).toEqual(resultsPayload);
    });

    it('should use the correct Judge0 language_id for the given language', async () => {
      mockFetchOnce({ status: ACCEPTED, stdout: encode('__RESULTS__[]'), stderr: null, compile_output: null });
      await runTestCases('def f(): pass', 'python', [], 'f');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.language_id).toBe(RUNTIMES.python.language_id);
    });

    it('should produce failing placeholder results when the marker is missing (e.g. a crash)', async () => {
      mockFetchOnce({ status: RUNTIME_ERROR, stdout: encode(''), stderr: encode('ReferenceError: twoSum is not defined'), compile_output: null });

      const result = await runTestCases('not valid code', 'javascript', testCases, 'twoSum');

      expect(result.passCount).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].error).toContain('ReferenceError');
    });

    it('should produce failing placeholder results when stdout cannot be parsed as JSON', async () => {
      mockFetchOnce({ status: ACCEPTED, stdout: encode('__RESULTS__not json'), stderr: null, compile_output: null });

      const result = await runTestCases('code', 'javascript', testCases, 'twoSum');

      expect(result.passCount).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].error).toContain('Could not parse test results');
    });
  });
});
