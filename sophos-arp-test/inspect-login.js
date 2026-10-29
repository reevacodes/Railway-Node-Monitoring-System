
require('dotenv').config();
const { chromium } = require('playwright');

async function main() {
    if (!process.env.SOPHOS_URL) {
        throw new Error('SOPHOS_URL is missing from .env');
    }

    const browser = await chromium.launch({
        headless: true
    });

    try {
        const page = await browser.newPage({
            ignoreHTTPSErrors: true
        });

        page.setDefaultTimeout(15000);

        await page.goto(process.env.SOPHOS_URL, {
            waitUntil: 'domcontentloaded'
        });

        console.log('Page title:', await page.title());
        console.log('Current URL:', page.url());

        const fields = await page.locator('input').evaluateAll(
            inputs => inputs.map(el => ({
                type: el.type,
                name: el.name,
                id: el.id,
                placeholder: el.placeholder,
                autocomplete: el.autocomplete
            }))
        );

        console.log('Input fields:', fields);
        console.log(
            'Buttons:',
            await page.locator('button, input[type="submit"]')
                .evaluateAll(els => els.map(el => ({
                    text: el.innerText || el.value,
                    type: el.type
                })))
        );
    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error('Inspection failed:', err.message);
    process.exitCode = 1;
});
