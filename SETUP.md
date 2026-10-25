# Connecting AgriLab Ops to its Google Sheet

AgriLab Ops (the staff system at `/ops`) keeps every record in one private Google Sheet. A small Google Apps Script attached to that sheet lets the website read and write it, and only for staff who sign in with their name and PIN.

Set this up once. It takes about 15 minutes.

## 1. Create the sheet and paste the script

1. Sign in to Google with the account that should own the lab's records. The AgriLab business account (for example `lawrence@agrilabsolutions.com`) is better than a personal one.
2. Create a new Google Sheet and name it **AgriLab Ops**.
3. In the sheet, open **Extensions → Apps Script**.
4. Delete the sample code in the editor, then paste everything from [`apps-script/Code.gs`](apps-script/Code.gs) in this repository. Click **Save**.
5. In the toolbar, choose the function **`setup`** and click **Run**.
6. Google asks for permission the first time. Choose your account. If you see "Google hasn't verified this app", click **Advanced → Go to AgriLab Ops**. It is your own script, so this warning is expected.

The sheet now has four tabs: **Samples**, **Stock**, **QC** and **Staff**.

## 2. Add the staff

In the **Staff** tab, add one row per person:

| Column | What to enter |
| --- | --- |
| id | Leave blank. It fills itself in. |
| name | The name they will type to sign in, for example `Wanjiku` |
| role | One of: `director`, `lab_manager`, `analyst`, `client_desk`, `field_officer` |
| pin | A PIN of 4 to 8 digits that only they know |
| active | `yes` (change it to `no` to remove someone's access) |

- Change the Director's starting PIN, `change-me-2468`, before going live.
- After each person's first sign-in, their PIN turns into a scrambled code in the sheet. That is normal. To reset a PIN, type a new one over the code.
- Only the **lab manager** and the **Director** can sign off results, and never results they entered themselves.
- After 5 wrong PINs, that name is locked for 15 minutes.

## 3. Publish the script as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `AgriLab Ops`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

"Anyone" lets the website reach the script. It does not open the sheet: every action except signing in needs a valid staff session, and the sheet stays private to its owner.

## 4. Point the website at it

1. In this repository on GitHub, open [`ops/config.js`](ops/config.js) and click the pencil to edit it.
2. Paste the Web app URL between the quotes:

   ```js
   window.AGRILAB_CONFIG = {
     apiUrl: 'https://script.google.com/macros/s/AKfy.../exec'
   };
   ```

3. Click **Commit changes**. The site updates within a minute or two.
4. Open `https://agrilab.lynnandalfred.com/ops/` and sign in.

## Changing the script later

Paste the new code, save, then go to **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same, so `config.js` does not change.

## Good to know

- **The sheet is the record.** The Director can read the Samples tab directly at any time, filter it, or download it. Avoid editing rows by hand while staff are working. Never reorder or rename the columns in row 1.
- **Sessions last 6 hours.** After that, staff sign in again.
- **Updates every minute.** The system refreshes itself every minute, and there is a Refresh button for anyone who wants the latest records at once.
- **Backups.** Google keeps a version history (**File → Version history**). A monthly **File → Download → Excel** copy kept off Google is a sensible extra.
- **Example data.** On the sign-in page, "Explore with example data" shows the system filled with made-up samples. Nothing in that mode is saved.
