# AgriLab Solutions website and staff system

Test address: **https://agrilab.lynnandalfred.com**

| Path | What it is |
| --- | --- |
| `/` | The public website (`index.html`) |
| `/ops/` | AgriLab Ops, the staff system for samples, results, sign-off, stock, QC and the daily close-out |
| `apps-script/Code.gs` | The Google Apps Script that stores AgriLab Ops records in a Google Sheet |
| `SETUP.md` | How to connect AgriLab Ops to its Google Sheet |

Everything is static, so GitHub Pages hosts it for free. Search engines are kept out while this is a test copy (`robots.txt`).

## Put it online with GitHub Pages

1. In this repository, open **Settings → Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main** and folder **/(root)**. Click **Save**.
3. Under **Custom domain**, enter `agrilab.lynnandalfred.com` and click **Save**. (The `CNAME` file in this repository already holds this name.)

## Point the subdomain at GitHub (Namecheap)

1. Sign in to Namecheap and open **Domain List → lynnandalfred.com → Manage → Advanced DNS**.
2. Click **Add New Record** and choose **CNAME Record**:
   - Host: `agrilab`
   - Value: `YOUR-GITHUB-USERNAME.github.io` (the account or organisation that owns this repository)
   - TTL: Automatic
3. Save with the green tick.
4. Wait a few minutes (sometimes up to an hour). Back in **Settings → Pages**, the domain check turns green. Then tick **Enforce HTTPS**.

This only adds `agrilab.` in front of the domain. Whatever already runs on `lynnandalfred.com` is untouched.

If the domain's nameservers are not Namecheap's (the Nameservers setting on the Domain tab says something other than "Namecheap BasicDNS"), add the same CNAME record wherever DNS is managed instead.

Optional but recommended: verify the domain under your GitHub account's **Settings → Pages → Add a domain**, so nobody else can attach a GitHub site to it.

## Connect the staff system

Follow [SETUP.md](SETUP.md). Until it is connected, `/ops/` shows a sign-in page with an option to explore example data.

## Moving to agrilabsolutions.com later

1. Change the `CNAME` file to `agrilabsolutions.com` (or `www.agrilabsolutions.com`) and update the custom domain in **Settings → Pages**.
2. At the domain's DNS:
   - for `agrilabsolutions.com`, add four **A** records with Host `@` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`
   - for `www`, add a **CNAME** record pointing to `YOUR-GITHUB-USERNAME.github.io`
3. In `index.html`, change the two `agrilab.lynnandalfred.com` addresses in the `og:` lines at the top.
4. Replace `robots.txt` with the following, so the public site can be found but the staff system stays out of search results:

   ```
   User-agent: *
   Disallow: /ops/
   ```

The Google Sheet and `ops/config.js` stay exactly as they are.
