
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const SELECTORS = {
    network: "#nav-network",
    neighbors: "#network-neighbors",
    arpDropdown: "#arpmodules",
    tableRows: "#DataTable tbody.yui-dt-data tr.yui-dt-rec",
    pageLabel: "#paging2 .yui-pg-current",
    nextPage: "#paging2 .yui-pg-next",
};

const MAX_PAGES = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function visible(locator) {
    return locator.isVisible().catch(() => false);
}

async function bodyText(page) {
    return page.locator("body").innerText().catch(() => "");
}

async function clickDisclaimer(page) {
    const accept = page.locator(
        'input[type="button"][value="I accept"]'
    );

    if (await visible(accept)) {
        console.log("Access disclaimer detected.");

        await accept.click();
        await sleep(1500);

        console.log("Disclaimer accepted.");
        return true;
    }

    return false;
}

async function waitForLoginOrDashboard(page, timeout = 15000) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
        if (
            await visible(page.locator(SELECTORS.network)) ||
            await visible(page.locator("#username")) ||
            await visible(page.locator(
                'input[type="button"][value="I accept"]'
            )) ||
            await visible(page.locator("#otp"))
        ) {
            return true;
        }

        await sleep(250);
    }

    return false;
}

async function authenticateIfNeeded(page, username, password) {
    const usernameField = page.locator("#username");
    const passwordField = page.locator("#password");
    const loginButton = page.locator('input[name="loginbutton"]');
    const acceptButton = page.locator(
        'input[type="button"][value="I accept"]'
    );
    const network = page.locator(SELECTORS.network);
    const otp = page.locator("#otp");

    console.log("Checking Sophos authentication state...");

    // Handle a disclaimer displayed before the login form.
    if (await visible(acceptButton)) {
        await clickDisclaimer(page);
        await waitForLoginOrDashboard(page, 10000);
    }

    // A dashboard may already be available through the session.
    if (await visible(network)) {
        console.log("Dashboard navigation detected.");
        return;
    }

    // Only submit credentials when both login fields are visible.
    const loginVisible =
        await visible(usernameField) &&
        await visible(passwordField);

    if (loginVisible) {
        console.log("Login form detected. Submitting credentials once.");

        await usernameField.fill(username);
        await passwordField.fill(password);
        await loginButton.click();

        // Wait for the next expected screen.
        await waitForLoginOrDashboard(page, 15000);

        // Sophos may show the access disclaimer after credentials are sent.
        if (await visible(acceptButton)) {
            console.log("Disclaimer appeared after login.");
            await clickDisclaimer(page);
        }
    }

    // Wait for the dashboard to render after the login transition.
    const started = Date.now();

    while (Date.now() - started < 15000) {
        if (await visible(network)) {
            console.log("Sophos dashboard navigation detected.");
            return;
        }

        if (await visible(otp)) {
            throw new Error(
                "Sophos requires OTP/MFA. Complete the authorized login " +
                "manually before running extraction."
            );
        }

        if (await visible(acceptButton)) {
            await clickDisclaimer(page);
        }

        await sleep(300);
    }

    const currentText = await bodyText(page);

    console.log("Authentication diagnostics:");
    console.log("URL:", page.url());
    console.log("Login form visible:", await visible(usernameField));
    console.log("Disclaimer visible:", await visible(acceptButton));
    console.log("Dashboard visible:", await visible(network));
    console.log("Page text:", currentText.slice(0, 1600));

    throw new Error(
        "Sophos dashboard was not detected. Check the page diagnostics above."
    );
}

async function ensureDashboard(page) {
    const network = page.locator(SELECTORS.network);

    if (await visible(network)) {
        return;
    }

    // Use the dashboard route observed during the successful login test.
    const current = new URL(page.url());

    if (current.pathname === "/" && !current.hash) {
        const dashboardUrl = new URL(
            "/webconsole/webpages/index.jsp",
            current.origin
        ).toString();

        console.log("Trying the observed Sophos dashboard route...");

        await page.goto(dashboardUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await sleep(1000);
        await clickDisclaimer(page);
    }

    await network.waitFor({
        state: "visible",
        timeout: 15000,
    });

    console.log("Dashboard confirmed:", page.url());
}

async function openNetwork(page) {
    const network = page.locator(SELECTORS.network);

    await network.waitFor({
        state: "visible",
        timeout: 15000,
    });

    const className = (await network.getAttribute("class")) || "";

    if (!className.includes("active-nav")) {
        await network.click();
        await sleep(700);
    }

    console.log("Network section opened.");
}

async function openNeighbors(page) {
    const neighbors = page.locator(SELECTORS.neighbors);
    const moreTabs = page.locator("#tabs-network li.more-tabs");

    // Neighbors may already be visible in the Network tab bar.
    if (!(await visible(neighbors))) {
        await moreTabs.waitFor({
            state: "visible",
            timeout: 10000,
        });

        console.log("Opening Network's More menu...");
        await moreTabs.click();
        await sleep(500);
    }

    await neighbors.waitFor({
        state: "visible",
        timeout: 10000,
    });

    await neighbors.click();
    await sleep(1000);

    await page.locator(SELECTORS.arpDropdown).waitFor({
        state: "visible",
        timeout: 15000,
    });

    console.log("Neighbors (ARP-NDP) page opened.");
}

async function selectIPv4(page) {
    const dropdown = page.locator(SELECTORS.arpDropdown);

    await dropdown.waitFor({
        state: "visible",
        timeout: 15000,
    });

    const options = await dropdown.locator("option").evaluateAll(
        (elements) =>
            elements.map((element) => ({
                value: element.value,
                text: (
                    element.innerText ||
                    element.textContent ||
                    ""
                ).trim(),
            }))
    );

    console.log("ARP dropdown options:", JSON.stringify(options));

    const ipv4 = options.find(
        (option) => /ipv4/i.test(option.text)
    );

    if (!ipv4) {
        throw new Error(
            "IPv4 neighbor-cache option was not found. " +
            "Review the dropdown options printed above."
        );
    }

    await dropdown.selectOption(ipv4.value);

    // Wait for the table to initialize. Some Sophos pages need time to refresh.
    await page.waitForFunction(
        ({ labelSelector, rowSelector }) => {
            const label = document.querySelector(labelSelector);
            const rows = document.querySelectorAll(rowSelector);

            return Boolean(label) &&
                /\(\s*1\s+of\s+\d+\s*\)/i.test(
                    label.textContent.trim()
                ) &&
                rows.length > 0;
        },
        {
            labelSelector: SELECTORS.pageLabel,
            rowSelector: SELECTORS.tableRows,
        },
        { timeout: 20000 }
    );

    console.log(
        "IPv4 table initialized:",
        (await page.locator(SELECTORS.pageLabel).innerText()).trim()
    );

    console.log("Selected IPv4 cache:", ipv4.text);
}

function isIPv4(value) {
    const parts = String(value).trim().split(".");

    if (parts.length !== 4) return false;

    return parts.every((part) => {
        if (!/^\d{1,3}$/.test(part)) return false;

        const number = Number(part);

        return number >= 0 && number <= 255;
    });
}

function isMacAddress(value) {
    return /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(
        String(value).trim()
    );
}

async function extractVisibleRows(page) {
    return page.locator(SELECTORS.tableRows).evaluateAll((rows) =>
        rows.map((row) => {
            const cells = Array.from(row.querySelectorAll("td")).map(
                (cell) =>
                    (cell.innerText || cell.textContent || "").trim()
            );

            return { cells };
        })
    );
}

function mapArpRow(row) {
    const cells = row.cells;

    // Preserve the column positions used by the original crawler,
    // but identify the IP and MAC from their actual cell contents.
    const ipIndex = cells.findIndex((cell) => isIPv4(cell));
    const macIndex = cells.findIndex((cell) => isMacAddress(cell));

    if (ipIndex < 0) {
        return null;
    }

    return {
        ip: cells[ipIndex] || "",
        mac: macIndex >= 0 ? cells[macIndex] : "",
        interface: cells[ipIndex + 2] || "",
        state: cells[ipIndex + 3] || "",
    };
}

async function extractArpPages(page) {
    const allEntries = [];
    const seenLabels = new Set();

    for (let index = 0; index < MAX_PAGES; index++) {
        const label = (
            await page.locator(SELECTORS.pageLabel)
                .innerText()
                .catch(() => "")
        ).trim();

        console.log(
            `Reading page ${index + 1}: ${label || "pagination label unavailable"}`
        );

        if (label && seenLabels.has(label)) {
            console.log("Pagination label repeated. Stopping.");
            break;
        }

        if (label) seenLabels.add(label);

        const visibleRows = await extractVisibleRows(page);
        const mapped = visibleRows
            .map(mapArpRow)
            .filter(Boolean);

        console.log(`Rows read on this page: ${mapped.length}`);
        allEntries.push(...mapped);

        const match = label.match(
            /\(?\s*(\d+)\s+of\s+(\d+)\s*\)?/i
        );

        if (!match) {
            console.log(
                "Pagination label unavailable; stopping after this page."
            );
            break;
        }

        const current = Number(match[1]);
        const total = Number(match[2]);

        if (current >= total) break;

        const next = page.locator(SELECTORS.nextPage);

        if (!(await visible(next))) {
            console.log("Next-page control is not visible. Stopping.");
            break;
        }

        const nextClass = await next.getAttribute("class").catch(() => "");
        const ariaDisabled = await next.getAttribute("aria-disabled")
            .catch(() => "");

        if (/disabled/i.test(nextClass) || ariaDisabled === "true") {
            console.log("Next-page control is disabled. Stopping.");
            break;
        }

        // Advance once and wait for the pagination label to change.
        await next.click();

        try {
            await page.waitForFunction(
                ({ selector, previous }) => {
                    const element = document.querySelector(selector);

                    return element &&
                        element.textContent.trim() !== previous;
                },
                {
                    selector: SELECTORS.pageLabel,
                    previous: label,
                },
                { timeout: 7000 }
            );
        } catch {
            console.log("Pagination did not advance. Stopping.");
            break;
        }
    }

    // Remove duplicate observations without discarding interface/state differences.
    const unique = new Map();

    for (const entry of allEntries) {
        const key = [
            entry.ip,
            entry.mac,
            entry.interface,
            entry.state,
        ].join("|");

        unique.set(key, entry);
    }

    return [...unique.values()];
}

function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function main() {
    const {
        SOPHOS_URL,
        SOPHOS_USERNAME,
        SOPHOS_PASSWORD,
    } = process.env;

    if (!SOPHOS_URL || !SOPHOS_USERNAME || !SOPHOS_PASSWORD) {
        throw new Error(
            "Missing SOPHOS_URL, SOPHOS_USERNAME, or SOPHOS_PASSWORD in .env"
        );
    }

    const profilePath = path.join(__dirname, "sophos-profile");
    let context;

    try {
        console.log("Starting one-time Sophos ARP extraction...");

        context = await chromium.launchPersistentContext(profilePath, {
            headless: true,
            ignoreHTTPSErrors: true,
        });

        // Use a fresh page to avoid inspecting a stale about:blank tab.
        const page = await context.newPage();
        page.setDefaultTimeout(15000);

        console.log("Navigating to Sophos firewall...");

        const response = await page.goto(SOPHOS_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        console.log(
            "HTTP status:",
            response ? response.status() : "No HTTP response"
        );
        console.log("Current URL:", page.url());

        await sleep(1500);

        await authenticateIfNeeded(
            page,
            SOPHOS_USERNAME,
            SOPHOS_PASSWORD
        );

        await ensureDashboard(page);

        await openNetwork(page);
        await openNeighbors(page);
        await selectIPv4(page);

        const entries = await extractArpPages(page);

        const timestamp = new Date().toISOString();

        const snapshot = {
            extractedAt: timestamp,
            source: "Sophos IPv4 Neighbor Cache",
            totalEntries: entries.length,
            entries,
        };

        const jsonPath = path.join(__dirname, "arp-snapshot.json");
        const csvPath = path.join(__dirname, "arp-snapshot.csv");
        const outputPath = path.join(__dirname, "arp_output.json");

        fs.writeFileSync(
            jsonPath,
            JSON.stringify(snapshot, null, 2),
            "utf8"
        );

        const csvHeader = ["ip", "mac", "interface", "state"];

        const csvContent = [
            csvHeader,
            ...entries.map((entry) => [
                entry.ip,
                entry.mac,
                entry.interface,
                entry.state,
            ]),
        ]
            .map((row) => row.map(csvEscape).join(","))
            .join("\r\n");

        fs.writeFileSync(csvPath, csvContent + "\r\n", "utf8");
        fs.writeFileSync(
            outputPath,
            JSON.stringify(entries, null, 2),
            "utf8"
        );

        const withMac = entries.filter((entry) =>
            isMacAddress(entry.mac)
        ).length;

        console.log("\n========== ARP EXTRACTION SUMMARY ==========");
        console.log("Snapshot timestamp:", timestamp);
        console.log("Unique entries:", entries.length);
        console.log("Entries with valid MAC addresses:", withMac);
        console.log("Entries without a recognized MAC:", entries.length - withMac);
        console.log("JSON snapshot:", jsonPath);
        console.log("CSV snapshot:", csvPath);
        console.log("Compatibility JSON:", outputPath);

        if (entries.length === 0) {
            console.warn(
                "WARNING: No IP entries were extracted. " +
                "Inspect the table columns and page selectors before using this snapshot."
            );
        }

        console.log("\nOne-time extraction complete. Polling is disabled.");
    } catch (error) {
        console.error("\nARP EXTRACTION FAILED:", error.message);
        process.exitCode = 1;
    } finally {
        if (context) {
            await context.close().catch(() => {});
        }
    }
}

main().catch((error) => {
    console.error("Fatal error:", error.message);
    process.exitCode = 1;
});