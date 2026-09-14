// Executes candidate-submitted code against structured test cases via the Judge0 CE API.
// Defaults to the official free public instance (https://ce.judge0.com); set JUDGE0_URL to
// point at a self-hosted instance instead, and JUDGE0_API_KEY/JUDGE0_API_HOST if that instance
// requires RapidAPI-style auth headers. JavaScript and Python run the candidate's code directly
// with the test cases passed in as JSON at runtime; Java and C++ have no JSON in their standard
// toolchain, so for those the test-calling code is generated as typed source literals at
// harness-build time instead.
//
// Test-case value shapes supported: numbers, strings, booleans, and flat (1D) arrays of those.
// Nested/object-shaped test data isn't supported by the Java/C++ harnesses in this pass.

const JUDGE0_URL = process.env.JUDGE0_URL || 'https://ce.judge0.com';
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || null;
const JUDGE0_API_HOST = process.env.JUDGE0_API_HOST || null;
const RESULTS_MARKER = '__RESULTS__';
const EXECUTE_TIMEOUT_MS = 20000;

// Caps a candidate submission's own resource use (an infinite loop or runaway recursion
// otherwise runs for however long the Judge0 instance's own defaults allow). A self-hosted
// or paid instance may permit higher ceilings; the public instance clamps to its own max
// regardless of what's requested here.
const CPU_TIME_LIMIT_S = 5;
const WALL_TIME_LIMIT_S = 10;
const MEMORY_LIMIT_KB = 128000; // 128 MB

const ACCEPTED_STATUS_ID = 3;
const TIME_LIMIT_EXCEEDED_STATUS_ID = 5;
const COMPILATION_ERROR_STATUS_ID = 6;

// Judge0 CE language IDs as of this writing — self-hosted instances can differ; check
// {JUDGE0_URL}/languages if execution starts failing with an unrecognized-language error.
const RUNTIMES = {
  javascript: { language_id: 93 }, // Node.js 18.15.0
  python: { language_id: 92 },     // Python 3.11.2
  java: { language_id: 91 },       // Java (JDK 17.0.6)
  cpp: { language_id: 54 },        // C++ (GCC 9.2.0)
};

function decodeBase64(value) {
  return value ? Buffer.from(value, 'base64').toString('utf-8') : '';
}

async function execute({ language_id, code, stdin = '' }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);

  const headers = { 'Content-Type': 'application/json' };
  if (JUDGE0_API_KEY) headers['X-RapidAPI-Key'] = JUDGE0_API_KEY;
  if (JUDGE0_API_HOST) headers['X-RapidAPI-Host'] = JUDGE0_API_HOST;

  let res;
  try {
    res = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source_code: Buffer.from(code, 'utf-8').toString('base64'),
        language_id,
        stdin: Buffer.from(stdin, 'utf-8').toString('base64'),
        cpu_time_limit: CPU_TIME_LIMIT_S,
        wall_time_limit: WALL_TIME_LIMIT_S,
        memory_limit: MEMORY_LIMIT_KB,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Judge0 request failed: ${err?.message || err}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Judge0 returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();

  if (data.status?.id === COMPILATION_ERROR_STATUS_ID) {
    return { stdout: '', stderr: decodeBase64(data.compile_output) || 'Compile error', code: 1 };
  }

  if (data.status?.id === TIME_LIMIT_EXCEEDED_STATUS_ID) {
    return { stdout: '', stderr: `Time limit exceeded (>${CPU_TIME_LIMIT_S}s CPU time) — check for an infinite loop or unbounded recursion.`, code: 1 };
  }

  return {
    stdout: decodeBase64(data.stdout),
    stderr: decodeBase64(data.stderr) || decodeBase64(data.message),
    code: data.status?.id === ACCEPTED_STATUS_ID ? 0 : 1,
  };
}

/* ============================================================
   Type inference — used to generate typed literals for Java/C++
   ============================================================ */

function inferType(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'int[]';
    const elType = inferType(value[0]);
    return `${elType}[]`;
  }
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double';
  if (typeof value === 'string') return 'string';
  throw new Error(`Unsupported test-case value type: ${typeof value}`);
}

/* ============================================================
   JavaScript — runtime JSON, closest to native
   ============================================================ */

function buildJsHarness(code, testCases, functionName) {
  const encoded = Buffer.from(JSON.stringify(testCases), 'utf-8').toString('base64');
  return `${code}

const __testCases = JSON.parse(Buffer.from('${encoded}', 'base64').toString('utf-8'));
const __results = [];
for (const tc of __testCases) {
  try {
    const actual = ${functionName}(...tc.input);
    const pass = JSON.stringify(actual) === JSON.stringify(tc.expected);
    __results.push({ pass, actual, expected: tc.expected });
  } catch (err) {
    __results.push({ pass: false, actual: null, expected: tc.expected, error: String(err && err.message || err) });
  }
}
console.log('${RESULTS_MARKER}' + JSON.stringify(__results));
`;
}

/* ============================================================
   Python — runtime JSON, closest to native
   ============================================================ */

function buildPythonHarness(code, testCases, functionName) {
  const encoded = Buffer.from(JSON.stringify(testCases), 'utf-8').toString('base64');
  return `${code}

import json, base64

__test_cases = json.loads(base64.b64decode('${encoded}').decode('utf-8'))
__results = []
for tc in __test_cases:
    try:
        actual = ${functionName}(*tc['input'])
        ok = actual == tc['expected']
        __results.append({'pass': ok, 'actual': actual, 'expected': tc['expected']})
    except Exception as e:
        __results.append({'pass': False, 'actual': None, 'expected': tc['expected'], 'error': str(e)})
print('${RESULTS_MARKER}' + json.dumps(__results))
`;
}

/* ============================================================
   Java / C++ — no runtime JSON available, so test calls are generated
   as typed source literals at build time instead of parsed at runtime.
   ============================================================ */

function javaLiteral(value, type) {
  if (type.endsWith('[]')) {
    const elType = type.slice(0, -2);
    return `new ${elType === 'string' ? 'String' : elType}[]{${value.map((v) => javaLiteral(v, elType)).join(', ')}}`;
  }
  if (type === 'string') return JSON.stringify(value);
  if (type === 'bool') return value ? 'true' : 'false';
  return String(value);
}

function javaType(type) {
  if (type.endsWith('[]')) return `${javaType(type.slice(0, -2))}[]`;
  if (type === 'string') return 'String';
  if (type === 'bool') return 'boolean';
  return type; // int, double
}

// Prints a Java value (of the given inferred type) as a single JSON-ish literal.
function javaPrintExpr(varName, type) {
  if (type.endsWith('[]')) return `java.util.Arrays.toString(${varName})`;
  if (type === 'string') return `("\\"" + ${varName} + "\\"")`;
  return `String.valueOf(${varName})`;
}

function buildJavaHarness(code, testCases, functionName) {
  const calls = testCases.map((tc, i) => {
    const argTypes = tc.input.map(inferType);
    const argExprs = tc.input.map((v, j) => javaLiteral(v, argTypes[j])).join(', ');
    const expectedType = inferType(tc.expected);
    const expectedLiteral = javaLiteral(tc.expected, expectedType);
    const isArray = expectedType.endsWith('[]');
    const compare = isArray
      ? `java.util.Arrays.equals(actual${i}, expected${i})`
      : `java.util.Objects.equals(actual${i}, expected${i})`;

    return `
        try {
            ${javaType(expectedType)} expected${i} = ${expectedLiteral};
            ${javaType(expectedType)} actual${i} = sol.${functionName}(${argExprs});
            boolean pass${i} = ${compare};
            __results.add("{\\"pass\\":" + pass${i} + ",\\"actual\\":" + ${javaPrintExpr(`actual${i}`, expectedType)} + ",\\"expected\\":" + ${javaPrintExpr(`expected${i}`, expectedType)} + "}");
        } catch (Exception e) {
            __results.add("{\\"pass\\":false,\\"actual\\":null,\\"expected\\":null,\\"error\\":\\"" + e.getMessage() + "\\"}");
        }`;
  }).join('\n');

  return `import java.util.*;

${code}

public class Main {
    public static void main(String[] args) {
        Solution sol = new Solution();
        List<String> __results = new ArrayList<>();
${calls}
        System.out.println("${RESULTS_MARKER}[" + String.join(",", __results) + "]");
    }
}
`;
}

function cppLiteral(value, type) {
  if (type.endsWith('[]')) {
    const elType = type.slice(0, -2);
    return `{${value.map((v) => cppLiteral(v, elType)).join(', ')}}`;
  }
  if (type === 'string') return JSON.stringify(value);
  if (type === 'bool') return value ? 'true' : 'false';
  return String(value);
}

function cppType(type) {
  if (type.endsWith('[]')) return `vector<${cppType(type.slice(0, -2))}>`;
  if (type === 'string') return 'string';
  if (type === 'bool') return 'bool';
  return type; // int, double
}

function cppPrintExpr(varName, type) {
  if (type.endsWith('[]')) {
    return `("[" + [&]{ string s; for (size_t __i = 0; __i < ${varName}.size(); __i++) { if (__i) s += ","; s += to_string(${varName}[__i]); } return s; }() + "]")`;
  }
  if (type === 'string') return `("\\"" + ${varName} + "\\"")`;
  if (type === 'bool') return `(${varName} ? "true" : "false")`;
  return `to_string(${varName})`;
}

function buildCppHarness(code, testCases, functionName) {
  const calls = testCases.map((tc, i) => {
    const argTypes = tc.input.map(inferType);
    const argExprs = tc.input.map((v, j) => cppLiteral(v, argTypes[j])).join(', ');
    const expectedType = inferType(tc.expected);
    const expectedLiteral = cppLiteral(tc.expected, expectedType);

    return `
    try {
        ${cppType(expectedType)} expected${i} = ${expectedLiteral};
        ${cppType(expectedType)} actual${i} = sol.${functionName}(${argExprs});
        bool pass${i} = (actual${i} == expected${i});
        __results.push_back(string("{\\"pass\\":") + (pass${i} ? "true" : "false") + ",\\"actual\\":" + ${cppPrintExpr(`actual${i}`, expectedType)} + ",\\"expected\\":" + ${cppPrintExpr(`expected${i}`, expectedType)} + "}");
    } catch (const std::exception& e) {
        __results.push_back(string("{\\"pass\\":false,\\"actual\\":null,\\"expected\\":null,\\"error\\":\\"") + e.what() + "\\"}");
    }`;
  }).join('\n');

  return `#include <bits/stdc++.h>
using namespace std;

${code}

int main() {
    Solution sol;
    vector<string> __results;
${calls}
    string joined;
    for (size_t i = 0; i < __results.size(); i++) { if (i) joined += ","; joined += __results[i]; }
    cout << "${RESULTS_MARKER}[" << joined << "]" << endl;
    return 0;
}
`;
}

function buildHarness(codeLanguage, code, testCases, functionName) {
  switch (codeLanguage) {
    case 'javascript': return buildJsHarness(code, testCases, functionName);
    case 'python': return buildPythonHarness(code, testCases, functionName);
    case 'java': return buildJavaHarness(code, testCases, functionName);
    case 'cpp': return buildCppHarness(code, testCases, functionName);
    default: throw new Error(`Unsupported code language: ${codeLanguage}`);
  }
}

function parseResultsFromStdout(stdout, stderr, total) {
  const markerIndex = stdout.indexOf(RESULTS_MARKER);
  if (markerIndex === -1) {
    const error = stderr?.trim() || 'No test results produced (the code likely failed to run or compile).';
    return Array.from({ length: total }, () => ({ pass: false, actual: null, expected: null, error }));
  }
  try {
    return JSON.parse(stdout.slice(markerIndex + RESULTS_MARKER.length).trim());
  } catch (err) {
    const error = `Could not parse test results: ${err.message}`;
    return Array.from({ length: total }, () => ({ pass: false, actual: null, expected: null, error }));
  }
}

// Phrasing each toolchain uses when the harness's call to `functionName` can't be resolved —
// covers both a genuine compile failure (Java/C++, where the harness is compiled alongside the
// candidate's code) and a caught runtime exception (JS/Python, where each test case's try/catch
// swallows it into that result's `error` field instead of crashing the whole run).
const NAME_MISMATCH_PATTERNS = [
  /is not defined/i,                  // JS ReferenceError / Python NameError
  /has no member named/i,             // C++ — calling a nonexistent method on the Solution instance
  /was not declared in this scope/i,  // C++ fallback phrasing
  /cannot find symbol/i,              // Java
];

// True only when every test case failed for what looks like the same reason: the candidate's
// function/method isn't named what the harness expects. A mix of pass/fail or varied errors
// means it's a real logic bug, not a naming mismatch, so this stays conservative on purpose.
function looksLikeSignatureMismatch(results, functionName) {
  if (!functionName || results.length === 0) return false;
  return results.every((r) => {
    const message = r.error || '';
    return message.includes(functionName) && NAME_MISMATCH_PATTERNS.some((pattern) => pattern.test(message));
  });
}

async function runTestCases(code, codeLanguage, testCases, functionName) {
  const runtime = RUNTIMES[codeLanguage];
  if (!runtime) throw new Error(`Unsupported code language: ${codeLanguage}`);

  const harness = buildHarness(codeLanguage, code, testCases, functionName);
  const { stdout, stderr } = await execute({ language_id: runtime.language_id, code: harness });

  let results = parseResultsFromStdout(stdout, stderr, testCases.length);
  const passCount = results.filter((r) => r.pass).length;

  if (passCount === 0 && looksLikeSignatureMismatch(results, functionName)) {
    const hint = `Your solution doesn't define a function/method named "${functionName}" — check the Function Signature above and make sure the name matches exactly.`;
    results = results.map((r) => ({ ...r, error: hint }));
  }

  return { results, passCount, total: testCases.length };
}

module.exports = { execute, runTestCases, buildHarness, inferType, RUNTIMES };
