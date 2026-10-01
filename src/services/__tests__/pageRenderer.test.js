jest.mock('puppeteer', () => ({ launch: jest.fn() }));

const puppeteer = require('puppeteer');
const { renderPageText } = require('../pageRenderer');

function makeBrowser({ text = 'PAGE TEXT', finalUrl = 'https://platform.torc.dev/#/profile/jane', gotoImpl, expanded = 0 } = {}) {
  const page = {
    setRequestInterception: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    goto: jest.fn(gotoImpl || (() => Promise.resolve())),
    // First evaluate clicks the expand buttons, second reads the text.
    evaluate: jest.fn().mockResolvedValueOnce(expanded).mockResolvedValueOnce(text),
    url: jest.fn().mockReturnValue(finalUrl),
  };
  return { page, browser: { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue() } };
}

describe('renderPageText', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the rendered text and final URL, then closes the browser', async () => {
    const { browser, page } = makeBrowser();
    puppeteer.launch.mockResolvedValue(browser);

    const result = await renderPageText('https://platform.torc.dev/#/profile/jane');

    expect(result).toEqual({ text: 'PAGE TEXT', finalUrl: 'https://platform.torc.dev/#/profile/jane' });
    expect(page.goto).toHaveBeenCalledWith('https://platform.torc.dev/#/profile/jane', expect.objectContaining({ waitUntil: 'networkidle2' }));
    expect(puppeteer.launch.mock.calls[0][0].args).toContain('--no-sandbox');
    expect(browser.close).toHaveBeenCalled();
  });

  it('blocks images, media, and fonts but lets other requests through', async () => {
    const { browser, page } = makeBrowser();
    puppeteer.launch.mockResolvedValue(browser);
    await renderPageText('u');

    const onRequest = page.on.mock.calls.find(([evt]) => evt === 'request')[1];
    const req = (type) => ({ resourceType: () => type, abort: jest.fn(), continue: jest.fn() });
    const img = req('image');
    const xhr = req('xhr');
    onRequest(img);
    onRequest(xhr);

    expect(img.abort).toHaveBeenCalled();
    expect(xhr.continue).toHaveBeenCalled();
  });

  it('closes the browser when navigation fails', async () => {
    const { browser } = makeBrowser({ gotoImpl: () => Promise.reject(new Error('timeout')) });
    puppeteer.launch.mockResolvedValue(browser);

    await expect(renderPageText('u')).rejects.toThrow('timeout');
    expect(browser.close).toHaveBeenCalled();
  });

  it('runs at most two browsers at once', async () => {
    let open = 0;
    let peak = 0;
    puppeteer.launch.mockImplementation(async () => {
      open++;
      peak = Math.max(peak, open);
      const { browser } = makeBrowser({ gotoImpl: () => new Promise((r) => setTimeout(r, 10)) });
      browser.close.mockImplementation(async () => { open--; });
      return browser;
    });

    await Promise.all([1, 2, 3, 4, 5].map(() => renderPageText('u')));

    expect(puppeteer.launch).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });
});
