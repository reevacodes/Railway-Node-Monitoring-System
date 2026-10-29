
require("dotenv").config();

const { chromium } = require("playwright");
const path = require("node:path");

async function isVisible(locator) {
    return locator.isVisible().catch(() => false);
}

async function main() {
    const {
        SOPHOS_URL,
        SOPHOS_USERNAME,
        SOPHOS_PASSWORD,
    } = process.env;

    if (!SOPHOS_URL || !SOPHOS_USERNAME || !SOPHOS_PASSWORD) {
        throw new Error(
            "Missing Sophos configuration. Check the required variable names in .env."
        );
    }

    const profilePath = path.join(__dirname, "sophos-profile");
    let context;

    try {
        console.log("Opening Sophos browser profile...");

        context = await chromium.launchPersistentContext(profilePath, {
            headless: true,
            ignoreHTTPSErrors: true,
        });

        // Create a fresh page so an old about:blank tab is not inspected.
        const page = await context.newPage();
        page.setDefaultTimeout(15000);

        console.log("Configured Sophos URL:", SOPHOS_URL);
        console.log("Navigating to Sophos firewall...");

        let response;

        try {
            response = await page.goto(SOPHOS_URL, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });
        } catch (error) {
            console.error("Navigation failed:", error.message);
            console.error("URL at failure:", page.url());
            throw error;
        }

        console.log("Navigation completed.");
        console.log(
            "HTTP status:",
            response ? response.status() : "No HTTP response"
        );
        console.log("Current URL:", page.url());

        // Allow the firewall's interface to finish rendering.
        await page.waitForTimeout(1500);

        const acceptButton = page.locator(
            'input[type="button"][value="I accept"]'
        );
        const declineButton = page.locator(
            'input[type="button"][value="I decline"]'
        );
        const usernameField = page.locator("#username");
        const passwordField = page.locator("#password");
        const loginButton = page.locator('input[name="loginbutton"]');
        const networkNavigation = page.locator("#nav-network");

        // Handle the authorized-use disclaimer before checking login.
        if (await isVisible(acceptButton)) {
            console.log(
                "Access disclaimer detected. Accepting the warning."
            );

            // Only proceed if you are authorized to access this firewall
            // and agree to the displayed warning.
            await acceptButton.click();
            await page.waitForTimeout(1500);
        }

        console.log(
            "Login form visible:",
            await isVisible(usernameField) &&
                await isVisible(passwordField)
        );

        // Submit credentials once only if the login form is visible.
        const loginRequired =
            await isVisible(usernameField) &&
            await isVisible(passwordField);

        if (loginRequired) {
            if (!(await isVisible(loginButton))) {
                throw new Error(
                    "Login fields are visible, but the login button was not found."
                );
            }

            console.log("Submitting credentials once...");

            await usernameField.fill(SOPHOS_USERNAME);
            await passwordField.fill(SOPHOS_PASSWORD);
            await loginButton.click();

            // Wait for a dashboard, disclaimer, OTP prompt, or login error.
            await Promise.race([
                networkNavigation.waitFor({
                    state: "attached",
                    timeout: 15000,
                }).catch(() => null),

                acceptButton.waitFor({
                    state: "visible",
                    timeout: 15000,
                }).catch(() => null),

                page.locator("#otp").waitFor({
                    state: "visible",
                    timeout: 15000,
                }).catch(() => null),
            ]);

            // A disclaimer may be displayed after credentials are accepted.
            if (await isVisible(acceptButton)) {
                console.log(
                    "Access disclaimer appeared after login."
                );

                await acceptButton.click();
                await page.waitForTimeout(1500);
            }
        } else if (await isVisible(networkNavigation)) {
            console.log("Dashboard navigation is already present.");
        } else if (await isVisible(declineButton)) {
            console.log("The access disclaimer is still visible.");
        } else {
            console.log(
                "Login fields are not visible. Authentication is not yet confirmed."
            );
        }

        // Allow any page transition to settle.
        await page.waitForTimeout(1500);

        // Diagnostics: never print usernames, passwords, cookies, or tokens.
        console.log("\n========== PAGE DIAGNOSTICS ==========");
        console.log("Final URL:", page.url());
        console.log(
            "Page title:",
            await page.title().catch(() => "(unavailable)")
        );

        const visibleText = await page
            .locator("body")
            .innerText()
            .catch(() => "(Could not read page text)");

        console.log("\nVisible page text:");
        console.log(visibleText.slice(0, 2500));

        const controls = await page
            .locator(
                "input:visible, button:visible, a:visible, select:visible"
            )
            .evaluateAll((elements) =>
                elements.slice(0, 40).map((element) => ({
                    tag: element.tagName,
                    type: element.getAttribute("type"),
                    name: element.getAttribute("name"),
                    id: element.id,
                    text: (
                        element.innerText ||
                        element.value ||
                        element.getAttribute("aria-label") ||
                        ""
                    ).trim().slice(0, 100),
                }))
            );

        console.log("\nVisible controls:");
        console.log(JSON.stringify(controls, null, 2));

        const loginStillVisible =
            await isVisible(usernameField) &&
            await isVisible(passwordField);

        const otpVisible = await isVisible(page.locator("#otp"));
        const disclaimerVisible = await isVisible(acceptButton);
        const dashboardVisible = await isVisible(networkNavigation);

        console.log("\n========== AUTHENTICATION STATUS ==========");

        if (dashboardVisible) {
            console.log(
                "Dashboard navigation detected. Verify that the page is fully authenticated."
            );
        } else if (otpVisible) {
            console.log(
                "OTP/MFA appears to be required. No automated retry was attempted."
            );
        } else if (loginStillVisible) {
            console.log(
                "Login form remains visible. Review the page text for an error."
            );
        } else if (disclaimerVisible) {
            console.log(
                "Disclaimer remains visible. Authentication is not confirmed."
            );
        } else {
            console.log(
                "Dashboard not detected. Authentication is not confirmed."
            );
        }

        console.log("\nDiagnostic test complete. Polling is disabled.");
    } finally {
        if (context) {
            await context.close().catch(() => {});
        }
    }
}

main().catch((error) => {
    console.error("\nTEST FAILED:", error.message);
    process.exitCode = 1;
});
