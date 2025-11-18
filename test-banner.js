const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const login = { email: 'access@adserve.no' };
    // const bannerUrls = [
    //     "https://dashboard.adserve.zone/test-404",
    //     "https://dashboard.adserve.zone/test-404/normal.html", //ไม่ติด
    //     "https://dashboard.adserve.zone/test-404/404-index.html", //ติด 404 หน้าเพจไม่มีอะไรแสดงได้เลย
    //     "https://dashboard.adserve.zone/test-404/404-some-asset.html", //ติดบางอย่างในเฟรม
    // ];

    const bannerUrls = process.argv.slice(2);
    if (bannerUrls.length === 0) {
        console.log("❌ กรุณาใส่ลิงก์ เช่น:");
        console.log("   node test.js <url1> <url2> <url3>");
        process.exit(1);
    }

    const allReports = [];

    async function loginIfNeeded() {
        await page.waitForTimeout(500);

        const modal = page.locator('#access-modal');
        const exists = await modal.count();
        const visible = await modal.isVisible().catch(() => false);

        if (exists && visible) {
            // console.log("🔐 Login modal detected → logging in...");
            const emailInput = modal.locator('input[type="email"], input[placeholder*="mail" i]').first();
            const submitBtn = modal.locator('button').first();
            await emailInput.waitFor({ state: 'visible' });
            await emailInput.fill(login.email);
            await submitBtn.click();
            await page.waitForTimeout(1000);
            console.log("✅ Login success (modal)");
            return;
        }

        const pageEmail = page.locator('input[type="email"]');
        if (await pageEmail.isVisible().catch(() => false)) {
            console.log("🔐 Login page detected → logging in...");
            await pageEmail.fill(login.email);
            await page.getByRole('button', { name: 'Access' }).click();
            await page.waitForTimeout(1000);
            console.log("✅ Login success (full page)");
            return;
        }

        console.log("ℹ️  Skipping login, no login required");
    }

    for (const url of bannerUrls) {
        console.log(`\n🚀 Testing banner: ${url}`);

        const issues = {
            pageStatus: null,
            iframe404s: [],
            assetFailures: [],
            frames: [],
        };

        page.removeAllListeners("response");

        // Track 404
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
                issues.assetFailures.push({ url: urlRes, type, iframeUrl: frame.url(), status });
            }
        });

        try { await page.goto(url, { waitUntil: "domcontentloaded" }); }
        catch (err) { console.log(`⚠️ initial page.goto failed → ${err.message}`); }

        await loginIfNeeded();

        try {
            const response = await page.goto(url, { waitUntil: "domcontentloaded" });
            issues.pageStatus = response?.status() || null;
        } catch (err) { console.log(`⚠️ page.goto after login failed → ${err.message}`); }

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

        // summary
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📄 Banner URL: ${url}`);
        console.log(`${'='.repeat(60)}`);

        console.log(`\n🌐 Page Status: ${issues.pageStatus === 200 ? '✅ 200 OK' : `❌ ${issues.pageStatus}`}`);

        console.log(`\n📊 Issues Found:`);
        console.log(`   🚨 Iframe 404s: ${issues.iframe404s.length > 0 ? `❌ ${issues.iframe404s.length}` : '✅ 0'}`);
        if (issues.iframe404s.length > 0) {
            issues.iframe404s.forEach((item, idx) => {
                console.log(`      ${idx + 1}. ${item.iframeUrl}`);
            });
        }

        console.log(`   ⚠️   Asset 404s: ${issues.assetFailures.length > 0 ? `❌ ${issues.assetFailures.length}` : '✅ 0'}`);
        if (issues.assetFailures.length > 0) {
            issues.assetFailures.forEach((item, idx) => {
                console.log(`      ${idx + 1}. ${item.url}`);
                console.log(`         └─ iframe: ${item.iframeUrl}`);
            });
        }

        console.log(`\n🖼️  Frames (${issues.frames.length} total):`);
        issues.frames.forEach((f, idx) => {
            const statusIcon = f.hasError ? '❌' : '✅';
            console.log(`\n   ${statusIcon} Frame ${idx + 1}:`);
            console.log(`      Name: ${f.name || '(no name)'}`);
            console.log(`      URL:  ${f.url}`);
            console.log(`      Title: ${f.title || '(no title)'}`);
        });

        console.log(`\n${'='.repeat(60)}\n`);

        allReports.push({ bannerUrl: url, issues });
    }
    // report saving
    const reportDir = path.join(__dirname, "reports");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    const reportPath = path.join(reportDir, "iframe-404-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(allReports, null, 2));
    console.log(`\n💾 Report saved to: ${reportPath}`);

    await browser.close();
})();
