
require("dotenv").config();
const { chromium } = require("playwright");

async function acceptDisclaimer(page) {
    const button = page.locator(
        'input[type="button"][value="I accept"]'
    );

    if (await button.isVisible().catch(() => false)) {
        await button.click();
        await page.waitForTimeout(2000);
    }
}

async function main() {
    const {
        SOPHOS_URL,
        SOPHOS_USERNAME,
        SOPHOS_PASSWORD,
    } = process.env;

    if (!SOPHOS_URL || !SOPHOS_USERNAME || !SOPHOS_PASSWORD) {
        throw new Error("Missing Sophos environment variables in .env");
    }

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({
            ignoreHTTPSErrors: true, // Temporary test workaround only.
        });

        const page = await context.newPage();
        page.setDefaultTimeout(15000);

        await page.goto(SOPHOS_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await page.waitForTimeout(1200);
        await acceptDisclaimer(page);

        const username = page.locator("#username");
        const password = page.locator("#password");

        if (
            await username.isVisible().catch(() => false) &&
            await password.isVisible().catch(() => false)
        ) {
            await username.fill(SOPHOS_USERNAME);
            await password.fill(SOPHOS_PASSWORD);
            await page.locator('input[name="loginbutton"]').click();
            await page.waitForTimeout(2500);
            await acceptDisclaimer(page);
        }

        await page.getByRole("link", {
            name: "Network",
            exact: true,
        }).click();

        await page.waitForTimeout(1200);

        console.log("\n========== NETWORK TAB STRUCTURE ==========");

        const structure = await page.locator("#tabs-network").evaluate(root => {
            function describe(el) {
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);

                return {
                    tag: el.tagName,
                    id: el.id || null,
                    text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 250),
                    className:
                        typeof el.className === "string"
                            ? el.className.slice(0, 150)
                            : null,
                    display: style.display,
                    visibility: style.visibility,
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    reactId: el.getAttribute("data-reactid"),
                };
            }

            return {
                tabs: Array.from(root.children).map(describe),
                ancestors: (() => {
                    const target = document.querySelector("#network-neighbors");
                    const result = [];
                    let el = target;

                    while (el && result.length < 7) {
                        result.push(describe(el));
                        el = el.parentElement;
                    }

                    return result;
                })(),
            };
        });

        console.log(JSON.stringify(structure, null, 2));

        console.log("\n========== POSSIBLE MORE CONTROLS ==========");

        const candidates = await page.locator(
            "button:visible, a:visible, li:visible, [role='button']:visible"
        ).evaluateAll(elements =>
            elements
                .map(el => ({
                    tag: el.tagName,
                    text: (el.innerText || "").trim().replace(/\s+/g, " "),
                    id: el.id || null,
                    title: el.getAttribute("title"),
                    ariaLabel: el.getAttribute("aria-label"),
                    className:
                        typeof el.className === "string"
                            ? el.className.slice(0, 120)
                            : null,
                }))
                .filter(el =>
                    /more|neighbor|arp|ndp|other|overflow/i.test(
                        `${el.text} ${el.id || ""} ${el.title || ""} ${el.ariaLabel || ""}`
                    )
                )
                .slice(0, 40)
        );

        console.log(JSON.stringify(candidates, null, 2));
        console.log("\nRead-only inspection complete.");
    } catch (error) {
        console.error("Inspection failed:", error.message);
    } finally {
        await browser.close();
    }
}

main();
