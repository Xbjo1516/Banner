import { firefox } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import links from "../data/link.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGIN_EMAIL = "access@adserve.no";

function deleteOld404Folders(rootDir) {
    if (!fs.existsSync(rootDir)) return;
    const items = fs.readdirSync(rootDir);
    for (const item of items) {
        const full = path.join(rootDir, item);
        if (fs.statSync(full).isDirectory() && item.startsWith("404-")) {
            fs.rmSync(full, { recursive: true, force: true });
            console.log(`🧹 Deleted old folder: ${full}`);
        }
    }
}

async function loginIfNeeded(page) {
    await page.waitForTimeout(500);

    const modal = page.locator("#access-modal");
    const exists = await modal.count();
    const visible = await modal.isVisible().catch(() => false);

    if (exists && visible) {
        const emailInput = modal.locator('input[type="email"], input[placeholder*="mail" i]').first();
        const submitBtn = modal.locator("button").first();
        await emailInput.waitFor({ state: "visible" });
        await emailInput.fill(LOGIN_EMAIL);
        await submitBtn.click();
        await page.waitForTimeout(1000);
        console.log("✅ Login success (modal)");
        return;
    }

    const pageEmail = page.locator('input[type="email"]');
    if (await pageEmail.isVisible().catch(() => false)) {
        await pageEmail.fill(LOGIN_EMAIL);
        await page.getByRole("button", { name: "Access" }).click();
        await page.waitForTimeout(1000);
        console.log("✅ Login success (full page)");
        return;
    }

    console.log("ℹ️  Skipping login, no login required");
}

(async () => {
    const browser = await firefox.launch({ headless: true });
    const page = await browser.newPage();

    let bannerUrls = process.argv.slice(2);
    let categoryUsed = "Manual Input links";

    if (bannerUrls.length === 0) {
        categoryUsed = "FiveNights";
        bannerUrls = links[categoryUsed];
        if (!bannerUrls || bannerUrls.length === 0) {
            console.error(`❌ Category "${categoryUsed}" not found or empty`);
            await browser.close();
            process.exit(1);
        }
    }

    const rootDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir);

    deleteOld404Folders(rootDir);

    const now = new Date();
    const timestamp =
        "404-" +
        now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + "_" +
        String(now.getHours()).padStart(2, "0") + "-" +
        String(now.getMinutes()).padStart(2, "0") + "-" +
        String(now.getSeconds()).padStart(2, "0");

    const sessionDir = path.join(rootDir, timestamp);
    fs.mkdirSync(sessionDir);

    let index = 1;

    for (const url of bannerUrls) {
        console.log(`\n🚀 Testing banner: ${url}`);

        const linkDir = path.join(sessionDir, `link-${index}`);
        fs.mkdirSync(linkDir);

        const issues = {
            pageStatus: null,
            iframe404s: [],
            assetFailures: [],
            frames: [],
        };

        page.removeAllListeners("response");
        const failedRequests = new Set();

        page.on("response", async (res) => {
            const status = res.status();
            if (status !== 404) return;

            const urlRes = res.url();
            if (failedRequests.has(urlRes)) return;
            failedRequests.add(urlRes);

            const type = res.request().resourceType();
            const frame = res.frame();
            const isInIframe = frame && frame.parentFrame() !== null;

            if (isInIframe && type === "document") {
                issues.iframe404s.push({ iframeUrl: frame.url(), status });
            } else if (isInIframe) {
                issues.assetFailures.push({
                    url: urlRes,
                    type,
                    iframeUrl: frame.url(),
                    status
                });
            }
        });

        try { await page.goto(url, { waitUntil: "domcontentloaded" }); } catch { }

        await loginIfNeeded(page);

        try {
            const response = await page.goto(url, { waitUntil: "domcontentloaded" });
            issues.pageStatus = response?.status() || null;
        } catch { }

        await page.waitForTimeout(1500);

        for (const frame of page.frames()) {
            if (frame.parentFrame()) {
                const hasError = issues.iframe404s.some(err => err.iframeUrl === frame.url());
                let title = "";
                try { title = await frame.title().catch(() => ""); } catch { }
                issues.frames.push({
                    url: frame.url(),
                    name: frame.name(),
                    title,
                    hasError
                });
            }
        }

        const screenshotPath = path.join(linkDir, "screenshot.jpg");
        try {
            await page.waitForTimeout(1000);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (e) {
            console.log(`⚠️ Screenshot failed: ${e.message}`);
        }

        const reportLines = [];
        reportLines.push(`Category: ${categoryUsed}`);
        reportLines.push(`URL: ${url}`);
        reportLines.push(`Timestamp: ${timestamp}`);
        reportLines.push("");
        reportLines.push(`Page Status: ${issues.pageStatus}`);
        reportLines.push("");
        reportLines.push(`Iframe 404s (${issues.iframe404s.length}):`);
        issues.iframe404s.forEach((i, idx) => reportLines.push(`  ${idx + 1}. ${i.iframeUrl}`));
        reportLines.push("");
        reportLines.push(`Asset 404s (${issues.assetFailures.length}):`);
        issues.assetFailures.forEach((i, idx) => {
            reportLines.push(`  ${idx + 1}. ${i.url}`);
            reportLines.push(`     iframe: ${i.iframeUrl}`);
        });
        reportLines.push("");
        reportLines.push(`Frames (${issues.frames.length}):`);
        issues.frames.forEach((f, idx) => {
            reportLines.push(`  Frame ${idx + 1}:`);
            reportLines.push(`     URL: ${f.url}`);
            reportLines.push(`     Name: ${f.name}`);
            reportLines.push(`     Title: ${f.title}`);
        });

        fs.writeFileSync(path.join(linkDir, "report.txt"), reportLines.join("\n"), "utf-8");
        console.log(`📁 Report saved to: ${path.join(linkDir, "report.txt")}`);

        index++;
    }

    await browser.close();
})();
