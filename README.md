# Printing Press Production Cost Calculator

Calculates production cost: materials, printing, finishing, labour, machine time,
setup and waste. No selling prices, profit, VAT or invoicing.

## Calculator layout

The form follows six sections: Job → Materials → Printing → Finishing → Labour →
Additional costs. The main printing stock, NCR copies, film, boards and covers all
live in Materials. Layout and waste overrides are expandable; expanded panels
stay open when stock or processing selections change. The machine is selected
under Printing. Cutting and other general operations are under Finishing.
Legacy saved lamination operations appear once in Materials so their costs remain
editable. New film rows contain their own optional processing selector.

Selected stocks now show their purchase-unit conversion (for example, AED 240
per pack ÷ 500 sheets = AED 0.48 per sheet). Admins can edit the purchase unit and
price directly from that stock. The material requirements table also shows the
actual rate used, including any press-sheet subdivision. Purchase prices remain
exactly as entered; no invoice pack sizes or VAT treatment are assumed. A pack-priced
material with a missing or invalid sheets-per-pack count blocks calculation.

## Confirmed NCR purchase prices

Your invoice specifies 500 sheets per pack, 70 × 100 cm:

| Stock | Packs purchased | Price per pack before VAT | Per sheet |
| --- | ---: | ---: | ---: |
| JH CB White 55gsm | 5 | AED 230 | AED 0.46 |
| JH CFB Pink 50gsm | 4 | AED 240 | AED 0.48 |
| JH CF Yellow 55gsm | 10 | AED 210 | AED 0.42 |

After deploying the updated index.html, an admin can open Settings → Confirmed
NCR purchase invoice and select **Apply invoice prices**. Matching stocks are
selected by name, GSM and sheet dimensions; ambiguous matches require a record
selection. Missing stocks can be added without replacing unrelated stock.
The authenticated app saves these prices to the existing shared database; the
source update itself does not change live records. Prices exclude invoice VAT.
Purchase quantities are documented as invoice notes, not an inventory ledger.
Existing saved calculation snapshots retain their historical costs. The engine
continues to use editable database prices; this panel is a supplied invoice
import, not a permanent price override. Updates happen only when its button is
pressed. Each successful row is retained if a later request fails; retry finishes
remaining rows without adding the successful rows twice.

## Multi-material jobs (version 1.1)

A job has one main printing stock plus any number of additional material rows.
Each row has a purpose and can optionally have a processing operation.

### NCR

1. Choose **NCR**. Quantity means complete sets, not individual paper pieces.
2. Choose the original stock under Material & layout.
3. Choose the copy stock in the automatically added NCR copy row.
4. Add more NCR copies for 1+2, 1+3 or any larger set.
5. Each copy can be printed or blank, with its own sides, colours, waste and stock.
6. Enter sets per pad/book if required. For 100 books of 50 sets, enter 5,000 sets
   and 50 sets per book. Partial last pads are shown; cost per pad is an average.
7. Add collating, numbering, gluing, perforation and binding under Finishing.
   Per-piece operations count sets; per-sheet operations count good press sheets
   across the original and all NCR copies. Use quantity or multiplier overrides
   when only particular layers need an operation.
8. Add cover/backing rows to calculate one cover or backing per pad. Add separate
   rows for separate front and back stocks.

Each printed copy uses the main job's printing machine. By default, its plates
and setup are charged as a separate run. Enter **0 plates** for reused plates and
enter the actual stock-change setup hours (or 0 if already included).

### PVC stickers, lamination and mounting

- Choose the main sticker stock and printing machine.
- **Add lamination film**: select film stock and choose a method:
  - Continuous printed roll: film must be at least as wide as the printing roll;
    good film length follows the good printed roll length.
  - Separate cut pieces: film has its own layout; this assumes pieces are cut
    and rearranged before laminating. Sheet printing also uses a piece layout.
- **Add mounting board**: choose foam/PVC board stock. Its own sheet dimensions
  determine how many purchased boards are required.
- Select a processing operation on the film/board row to charge laminating or
  pasting, or add these under Finishing. Select each operation only once.
- Material-only film and board rows do not incur additional printing charges.
- Rates for processing must exclude any material charged separately. Legacy
  inclusive lamination rates must be reviewed to avoid double charging film.

Automatic rows calculate good sheets or linear metres, then their own waste.
Empty quantity means automatic. A manual override is good press sheets or metres
before waste; sheet overrides must be whole sheets. Layouts remain the geometric
preview even when quantities are overridden. Additional non-NCR materials default
to zero waste so the operator can enter appropriate film/board waste separately.

**Other / manual quantity** preserves the old behaviour: sheets for sheet/pack
stock, metres for metre/roll stock, m² for area stock, or kg/litres/pieces.

Processing quantities default to pieces/sets, good sheets, finished area in m²,
roll length (or perimeter for sheets), or once per job. Hourly operations need
manual hours. Manual overrides can optionally scale in quantity comparisons.

All material requirements, the complete job and full results are saved. Extra
material child rows use the existing `other` role; detailed purposes and settings
are retained in `job_snapshot` and `full_result`. The single printing child row
continues to describe the main run; full_result holds the complete multi-run cost
breakdown. Legacy saved jobs without a purpose still use manual quantities.

## Files

- `index.html`: deployable app, containing the CSS and all three source scripts.
- `src/`: readable app.css, engine.js, seed.js and cloud.js.
- `tests/`: engine checks, multi-material checks, random stress test and mock app
  tests with their mock database and seed adapter.
- `tools/build.py`: rebuilds index.html from src without changing the HTML shell.
- `schema.sql`: original database reference, not a complete installation script.
- `package.json`: test commands and jsdom development dependency.

## Rebuild and test

Requires Python 3 for rebuilding and Node.js/npm for tests.

```sh
python3 tools/build.py
npm install
npm test
npm run stress
```

The separate uploaded source and test files also work in a flat folder. The ZIP
uses the src/tests layout above. A package lock is not included; dependency
installation will create one.

## Deployment and database

Serve index.html through an existing static hosting service. It still loads the
Supabase browser SDK and web fonts externally, and needs internet access.
The source retains the original Supabase project URL and public anonymous key.
Login, shared rates and saved jobs require that project's existing backend.
No live database or hosted deployment was changed or verified in this update.

The supplied schema.sql is incomplete for the app: it lacks profiles, permission
policies, job_snapshot, created_by, generated display IDs and some newer material
units/categories. Do not use it alone to recreate the backend. The existing
multi-write save path is not transactional and can leave partial records if a
request fails. Resolving those backend issues is a separate migration task.

## Original data items to confirm

The original README reported four materials needing prices: SINAR Woodfree Blue,
Euro Premium Eggshell, AA A4 Paper and Mounting Tape. It also listed FB 350 and
Food Board 350GSM separately. Confirm these against the actual database.
There is still no purchase-invoice entry screen. Demo rates are examples, not
verified production prices.
