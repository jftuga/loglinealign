"""Optional browser integration checks; uses the demo's Playwright environment.

Run after make web:
  demo/fc-timeout/.venv/bin/python tests/browser-find.py

window.find exercises the browser's text-search engine. Firefox also scrolls to
matches; Chromium's JavaScript API does not (even on a minimal page). The actual
browser toolbar's shortcuts, scrolling, and match count need manual verification.
No network requests or new project dependencies are needed.
"""
import argparse
from pathlib import Path
from time import monotonic

from playwright.sync_api import expect, sync_playwright


def ready(page, count):
    expect(page.locator('#browser-find-status')).to_have_text(
        f'Browser Find ready: all {count:,} retained lines are searchable with Ctrl+F / Cmd+F.', timeout=60000)
    expect(page.locator('.log-row')).to_have_count(count)
    expect(page.locator('#viewport')).not_to_have_attribute('aria-busy', 'true')


def find(page, query, backwards=False):
    return page.evaluate('''({query, backwards}) => {
      getSelection().removeAllRanges();
      return window.find(query, false, backwards, true);
    }''', {'query': query, 'backwards': backwards})


def load(page, text):
    page.locator('#file-picker').set_input_files({
        'name': 'search.log', 'mimeType': 'text/plain', 'buffer': text.encode()})
    expect(page.locator('#copy')).to_be_enabled(timeout=60000)


def open_page(browser):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.goto(Path('dist/loglinealign.html').resolve().as_uri())
    return page


def exercise(browser, name):
    page = open_page(browser)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    lines = [f'2026-01-01T00:00:{i % 60:02d}Z {"keep" if i % 2 else "omit"} marker-{i:06d}' for i in range(1203)]
    # A unique long line exercises both axes of scrolling and safe text insertion.
    lines[-1] += ' <script>not executable</script> ' + 'x' * 1000 + ' horizontal-target'
    load(page, '\n'.join(lines))
    assert page.locator('.log-row').count() < 100
    page.locator('#settings-tab').click()
    page.locator('#browser-find').check()
    ready(page, 1203)
    assert find(page, 'horizontal-target')
    if name == 'firefox':
        assert page.locator('#viewport').evaluate('(el) => el.scrollLeft > 0')
    assert find(page, 'marker-001199', True)
    if name == 'firefox':
        assert page.locator('#viewport').evaluate('(el) => el.scrollTop > 1000')
    before = page.locator('#rows').inner_text()
    page.locator('#color').uncheck()
    assert page.locator('#rows').inner_text() == before
    assert page.locator('.log-row').first.evaluate('(row) => getComputedStyle(row).color') == page.locator('#viewport').evaluate('(el) => getComputedStyle(el).color')
    page.locator('#no-filename').check()
    ready(page, 1203)
    assert '[search.log]' not in page.locator('#rows').inner_text()
    page.locator('#reverse').check()
    ready(page, 1203)
    assert '00:00:59Z' in page.locator('.log-row').first.inner_text()
    page.locator('#filter-tab').click()
    page.locator('#filter-text').fill('keep')
    ready(page, 601)
    assert 'omit' not in page.locator('#rows').inner_text()
    assert page.locator('.log-row mark').count() == 601
    assert find(page, 'marker-001199')
    assert not find(page, 'marker-001202')
    page.locator('#download-tab').click()
    with page.expect_download() as download:
        page.locator('#download').click()
    assert Path(download.value.path()).read_text() == page.locator('#rows').inner_text() + '\n'
    page.locator('#settings-tab').click()
    page.locator('#browser-find').uncheck()
    expect(page.locator('#browser-find-panel')).to_be_hidden()
    expect(page.locator('.log-block')).to_have_count(0)
    assert page.locator('.log-row').count() < 100
    # Changes during a pending batch must not append stale rows to a new result.
    page.evaluate('''() => {
      const toggle = document.querySelector('#browser-find');
      toggle.checked = true; toggle.dispatchEvent(new Event('change'));
      const input = document.querySelector('#filter-text');
      input.value = 'marker-001199'; input.dispatchEvent(new Event('input'));
    }''')
    ready(page, 1)
    assert 'marker-001199' in page.locator('.log-row').inner_text()
    page.locator('#filter-tab').click()
    page.locator('#filter-text').fill('no-matches-at-all')
    expect(page.locator('.log-row')).to_have_count(0)
    expect(page.locator('#browser-find-panel')).to_be_hidden()
    page.locator('#filter-text').fill('[')
    page.locator('#filter-regex').click()
    expect(page.locator('#filter-error')).to_be_visible()
    page.locator('#filter-text').fill('marker-001199')
    ready(page, 1)
    page.locator('#settings-tab').click()
    page.locator('#remerge').click()
    ready(page, 1)
    assert not errors, errors
    page.close()

    for count in (70000, 105000):
        page = open_page(browser)
        page.on('pageerror', lambda error: errors.append(str(error)))
        # Approximately 143 UTF-8 bytes per line, matching the demo's density.
        text = '\n'.join(f'2026-01-01T00:00:00Z keep marker-{i:06d} ' + 'x' * 104 for i in range(count))
        load(page, text)
        page.locator('#settings-tab').click()
        page.locator('#browser-find').check()
        expect(page.locator('#browser-find-continue')).to_be_visible()
        assert page.locator('.log-row').count() < 100
        page.locator('#browser-find-cancel').click()
        expect(page.locator('#browser-find')).not_to_be_checked()
        page.locator('#browser-find').check()
        # Start and cancel in the same task while the first worker batch is pending.
        page.evaluate("document.querySelector('#browser-find-continue').click(); document.querySelector('#browser-find-cancel').click()")
        expect(page.locator('#browser-find-panel')).to_be_hidden()
        page.locator('#browser-find').check()
        # Cancel after some rows have actually been appended, then release them.
        page.evaluate('''() => {
          const observer = new MutationObserver(() => {
            if (document.querySelectorAll('.log-block').length >= 2) {
              observer.disconnect();
              document.querySelector('#browser-find-cancel').click();
            }
          });
          observer.observe(document.querySelector('#rows'), {childList: true});
          document.querySelector('#browser-find-continue').click();
        }''')
        expect(page.locator('#browser-find')).not_to_be_checked()
        expect(page.locator('.log-block')).to_have_count(0)
        page.locator('#browser-find').check()
        started = monotonic()
        page.locator('#browser-find-continue').click()
        ready(page, count)
        duration = monotonic() - started
        for index in (0, count // 2, count - 1):
            assert find(page, f'marker-{index:06d}')
        if name == 'firefox':
            assert page.locator('#viewport').evaluate('(el) => el.scrollTop > 1000000')
        print(f'{name}: {count:,} lines ready in {duration:.2f}s; beginning/middle/end searchable', flush=True)
        page.locator('#filter-tab').click()
        page.locator('#filter-text').fill(f'marker-{count - 1:06d}')
        ready(page, 1)  # Filtering below the threshold does not prompt again.
        expect(page.locator('#browser-find-continue')).to_be_hidden()
        page.close()

    # The byte threshold also warns for a small number of very long lines.
    page = open_page(browser)
    load(page, '\n'.join('2026-01-01T00:00:00Z ' + 'x' * 11000 for _ in range(1000)))
    page.locator('#settings-tab').click()
    page.locator('#browser-find').check()
    expect(page.locator('#browser-find-continue')).to_be_visible()
    expect(page.locator('#browser-find-status')).to_contain_text('1,000 retained lines (11.0 MB)')
    page.locator('#expand-vertical').click()
    expect(page.locator('#browser-find-cancel')).to_be_visible()
    page.locator('#browser-find-cancel').click()
    page.close()
    assert not errors, errors
    print(f'{name}: lifecycle, colors, highlights, export, warning, cancellation, and stale-batch checks passed', flush=True)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--browsers', nargs='+', choices=['firefox', 'chromium', 'chrome', 'msedge'], default=['firefox', 'chromium'])
args = parser.parse_args()
with sync_playwright() as playwright:
    for name in args.browsers:
        browser = (playwright.chromium.launch(channel=name) if name in ('chrome', 'msedge') else getattr(playwright, name).launch())
        try:
            exercise(browser, name)
        finally:
            browser.close()
