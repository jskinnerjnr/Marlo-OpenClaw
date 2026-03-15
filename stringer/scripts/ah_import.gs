// JSM — Austin-Healey Parts Database
// Import Script v1
// Paste into Extensions > Apps Script, then save.

const MP26_ID  = '17P5Vacte1UZpf-QFGlTnAiZ7HzWhNI0vZ_iAq2ypKAg'; // Master Parts 2026
const PL_ID    = '1RZ5oszYXJCrvr_Oi7GYOZNfNuTxJ5sdqDPF8HtwlvTE';  // Price List Overhaul
const AH_COLOURS = ['BLK','AHGRY','BLU','GRN','RED'];
const COLOUR_NAMES = {BLK:'Black',AHGRY:'AH Grey',BLU:'Blue',GRN:'Green',RED:'Red'};
const INDIR = '=INDIRECT(ADDRESS(ROW()-1,COLUMN()))';

// ── Menu ──────────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('JSM Import')
    .addItem('▶ Process Raw Tab', 'processRaw')
    .addToUi();
}

// ── Main ──────────────────────────────────────────────────────────────────────
function processRaw() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const rawSh   = ss.getSheetByName('Raw');
  const ovSh    = ss.getSheetByName('Overview');
  const dtSh    = ss.getSheetByName('Detailed');

  const rawData = rawSh.getDataRange().getValues();
  if (rawData.length < 4) {
    SpreadsheetApp.getUi().alert('Raw tab is empty — paste your Sage P/Ns into col A from row 4 down.');
    return;
  }

  // ── Load external data ──────────────────────────────────────────────────
  const sageMap  = loadSage();
  const ahMap    = loadAhOverview();
  const jsSrnRows = loadJsSrn();

  // ── Parse Raw into unique Part × Material groups ────────────────────────
  const groups = {}; // key = basePn

  // Rows 1-3 are title/instructions/column headers — data always starts at row 4 (index 3)
  const startRow = 3;

  for (let i = startRow; i < rawData.length; i++) {
    const row = rawData[i];
    const pn  = String(row[0]).trim();
    if (!pn || !pn.startsWith('AH-')) continue;

    const parsed = parsePn(pn);
    if (!parsed) continue;

    const { basePn, material, colourCode } = parsed;

    // Skip bare custom PNs (no colour suffix) — they are derived automatically
    // from the base PN via deriveCustomPn(). If treated as their own group they
    // generate phantom colour rows with no Sage data.
    if (colourCode === 'CUSTOM') continue;

    if (!groups[basePn]) {
      groups[basePn] = { basePn, material, pns: {} };
    }
    groups[basePn].pns[colourCode] = pn;
  }

  if (Object.keys(groups).length === 0) {
    SpreadsheetApp.getUi().alert('No valid AH part numbers found in Raw tab.');
    return;
  }

  // ── Get existing Overview PNs so we don't duplicate ────────────────────
  const ovData    = ovSh.getDataRange().getValues();
  // Col B (index 1) = Parent P/N (base PN), col C (index 2) = Child P/N (BLK variant)
  const existingPns = new Set(ovData.slice(1).flatMap(r => [String(r[1]||'').trim(), String(r[2]||'').trim()]));
  const ovLastRow = ovSh.getLastRow();
  const dtLastRow = dtSh.getLastRow();

  let ovRow = ovLastRow + 1;
  let added = 0;

  // Sort group keys for consistent ordering
  const sortedBases = Object.keys(groups).sort();

  // Pre-compute combined JS Snr string per 4-digit group (Vinyl + Leather combined in one cell)
  const combinedJsSrn = {};
  for (const basePn of sortedBases) {
    const pfx4 = basePn.replace(/^AH-/,'').slice(0,4);
    if (!combinedJsSrn[pfx4]) combinedJsSrn[pfx4] = [];
    const mat    = groups[basePn].material;
    const pfx2   = basePn.replace(/^AH-/,'').slice(0,2);
    const ptDesc  = (sageGet(sageMap, (groups[basePn].pns['BLK'] || basePn+'-BLK'), 1)||'').split(':')[0];
    const range  = buildJsSrnRange(jsSrnRows, pfx2, ptDesc, mat);
    if (range && !combinedJsSrn[pfx4].includes(range)) combinedJsSrn[pfx4].push(range);
  }
  // Join multiple ranges with newline
  for (const k of Object.keys(combinedJsSrn)) {
    combinedJsSrn[k] = combinedJsSrn[k].join('\n');
  }

  let lastGroupPrefix = null; // tracks 4-digit prefix to detect first row of each dataset group

  for (const basePn of sortedBases) {
    if (existingPns.has(basePn)) {
      Logger.log(`Skipping ${basePn} — already in Overview`);
      continue;
    }

    const { material, pns } = groups[basePn];
    const blkSagePn = `${basePn}-BLK`;
    const blkAhPn   = `${basePn}-blk`;

    // Pull price & weight — Sage is source of truth
    let price  = sageGet(sageMap, blkSagePn, 4) || ahGet(ahMap, blkAhPn, 11) || '';
    let weight = sageGet(sageMap, blkSagePn, 3) || ahGet(ahMap, blkAhPn, 17) || '';

    // Web fields from AH Overview
    const also  = ahGet(ahMap, blkAhPn, 19);
    const webD  = ahGet(ahMap, blkAhPn, 26);
    const webA  = ahGet(ahMap, blkAhPn, 20);
    const webB  = ahGet(ahMap, blkAhPn, 21);
    const webC  = ahGet(ahMap, blkAhPn, 22);
    const unit  = sageGet(sageMap, blkSagePn, 2) || ahGet(ahMap, blkAhPn, 14) || 'SET';
    const cat   = sageGet(sageMap, blkSagePn, 5) || '';
    const dept  = sageGet(sageMap, blkSagePn, 6) || '1';

    // Parse basic name & model from description
    const descRaw = sageGet(sageMap, blkSagePn, 1) || ahGet(ahMap, blkAhPn, 5) || '';
    const descParts = descRaw.split(':');
    const basicName = titleCase(descParts[0] || '');
    const model     = descParts[descParts.length - 1] || '';
    const sageDesc  = `${descParts[0] || ''}:${material}:${model}`;

    const status = (!weight || weight === '0') ? '⚠ Review' : 'OK';

    // Column letter helper (0=A, 26=AA, 27=AB, 28=AC)
    function col(i) {
      if (i < 26) return String.fromCharCode(65 + i);
      return 'A' + String.fromCharCode(65 + i - 26);
    }

    // ── Write Overview row (29 cols A–AC) ─────────────────────────────
    const blkPn    = pns['BLK'] || `${basePn}-BLK`;  // BLK variant PN for Overview anchor

    // Derive Grandparent P/N: AH-XXYYZZ → AH-XX-YY-
    // e.g. AH-640100 → digits=640100 → AH-64-01-
    function deriveGrandparent(base) {
      const m = base.match(/^AH-(\d{2})(\d{2})/);
      return m ? `AH-${m[1]}-${m[2]}-` : '';
    }

    // Derive New P/N: reformat Sage PN with dashes every 2 digits, lowercase colour suffix
    // e.g. AH-640100-BLK   → AH-64-01-00-blk
    //      AH-640120-G-BLK  → AH-64-01-20-G-blk
    //      AH-640101        → AH-64-01-01        (custom, no colour)
    //      AH-640121-G      → AH-64-01-21-G      (custom with material suffix)
    function deriveNewPn(sagePn) {
      // Check material-only suffix FIRST (e.g. AH-640121-G, AH-640123-S)
      // to avoid treating -G/-S as a colour code
      const mMat = sagePn.match(/^AH-(\d{2})(\d{2})(\d{2})(-[GS])$/i);
      if (mMat) {
        return `AH-${mMat[1]}-${mMat[2]}-${mMat[3]}${mMat[4].toUpperCase()}`;
      }
      // With colour suffix (and optional material): AH-640100-BLK or AH-640120-G-BLK
      const mCol = sagePn.match(/^AH-(\d{2})(\d{2})(\d{2})(-[GS])?-([A-Z]{2,})$/i);
      if (mCol) {
        const mat = mCol[4] ? mCol[4].toUpperCase() : '';
        const col = mCol[5].toLowerCase();
        return `AH-${mCol[1]}-${mCol[2]}-${mCol[3]}${mat}-${col}`;
      }
      // Plain number, no suffix: AH-640101
      const mNum = sagePn.match(/^AH-(\d{2})(\d{2})(\d{2})$/i);
      if (mNum) return `AH-${mNum[1]}-${mNum[2]}-${mNum[3]}`;
      return '';
    }

    const grandparent = deriveGrandparent(basePn);
    const newPn       = deriveNewPn(blkPn);

    // Structure matches manually entered rows:
    // A=Grandparent P/N (auto), B=Parent P/N (=basePn), C=Child(Sage)P/N (=BLK variant)
    // G=Model, I=Basic Name, L=Sage Desc, M=Material, N=Primary Colour (Black), O=Secondary (n/a)
    // P=Unit, Q=Cat, R=Dept, T=Price, U=Weight, V=Also In, W=Web Details, X-Z=Web Cats, AC=Status
    const ovRowData = [
      grandparent,    // A: Grandparent P/N — auto-derived e.g. AH-64-01-
      basePn,         // B: Parent P/N — the base PN without colour (e.g. AH-640100)
      blkPn,          // C: Child (Sage) P/N — BLK variant as the reference row
      newPn, combinedJsSrn[basePn.replace(/^AH-/,'').slice(0,4)] || '', '', // D-F: New P/N, JS Snr (combined Vinyl+Leather), OEM
      model,'',       // G-H: Model(s), Series
      basicName,      // I: Basic Name (Current)
      '','',          // J-K: Basic Name (New), Basic Spec
      sageDesc,       // L: Sage Part Description
      material,       // M: Material
      'Black','n/a',  // N-O: Primary Colour = Black (BLK is reference row), Secondary = n/a
      unit,           // P: Unit of Sale
      cat,dept,'',    // Q-S: Category, Dept, HS Code
      price,weight,   // T-U: Sales Price £, Weight (kg)
      also,           // V: Also Available In
      webD,           // W: Web Details
      webA,webB,webC, // X-Z: Web Cat A, B, C
      '','',          // AA-AB: Location, BOM/Notes
      status          // AC: Status
    ];
    ovSh.getRange(ovRow, 1, 1, 29).setValues([ovRowData]);
    // Green only on the first material variant of a new 4-digit group (e.g. 6401xx Vinyl is first; 6401xx Leather-G is not)
    const groupPrefix = basePn.replace(/^AH-/,'').slice(0,4); // e.g. "6401"
    const isFirstOfGroup = groupPrefix !== lastGroupPrefix;
    if (isFirstOfGroup) {
      ovSh.getRange(ovRow, 1, 1, 29).setBackground('#D9EAD3');
    } else {
      ovSh.getRange(ovRow, 1, 1, 29).setBackground('#F4F7FF');
    }
    lastGroupPrefix = groupPrefix;

    // ── Write Detailed rows (29 cols, same structure) ──────────────────
    const anchor = dtLastRow + 1 + (added * (AH_COLOURS.length + 1));
    const customPn = pns['CUSTOM'] || pns['custom'] || deriveCustomPn(basePn);

    // Build anchor row: link non-colour cols directly to Overview, set colour cols
    function anchorRow(fullPn, colName) {
      const r = new Array(29).fill('');
      // Overview references for all cols except C (P/N), N (Primary), O (Secondary)
      for (let i = 0; i < 29; i++) {
        if (i === 2) r[i] = fullPn;                          // C: this row's Sage P/N
        else if (i === 13) r[i] = colName;                   // N: Primary Colour
        else if (i === 14) r[i] = 'n/a';                      // O: Secondary Colour (n/a — single colour product)
        else r[i] = `=Overview!${col(i)}${ovRow}`;
      }
      return r;
    }

    // INDIRECT row: inherit everything from row above except P/N and colours
    function indirectRow(fullPn, colName) {
      const r = new Array(29).fill(INDIR);
      r[2]  = fullPn;   // C: this row's Sage P/N
      r[13] = colName;  // N: Primary Colour
      r[14] = 'n/a';    // O: Secondary Colour (n/a)
      return r;
    }

    AH_COLOURS.forEach((cc, i) => {
      const colName  = COLOUR_NAMES[cc];
      const fullPn   = pns[cc] || `${basePn}-${cc}`;
      // Look up JS Snr P/N for this specific colour variant using its Sage description
      const colNewPn = deriveNewPn(fullPn); // per-colour New P/N e.g. AH-64-01-00-ahgry
      const dtRow    = (i === 0) ? anchorRow(fullPn, colName) : indirectRow(fullPn, colName);
      dtRow[3] = colNewPn;   // col D: New P/N (per-colour, override INDIRECT/Overview ref)
      // col E (JS Snr): anchor row already has =Overview!E${ovRow} via anchorRow(); INDIRECT rows inherit it
      const dtRange = dtSh.getRange(anchor + i, 1, 1, 29);
      dtRange.setValues([dtRow]);
      if (i === 0) dtRange.setBackground('#D9EAD3'); // light green — BLK anchor (first of group)
      else dtRange.setBackground('#F4F7FF');         // light blue — middle colour rows
    });

    // Custom row: same as INDIRECT but with price uplift; New P/N derived from customPn
    const customRow = indirectRow(customPn, 'Custom');
    customRow[3] = deriveNewPn(customPn); // col D: New P/N for custom row
    customRow[14] = 'n/a';                                 // O: Secondary Colour
    customRow[19] = `=T${anchor}*1.085`;                   // T: Sales Price × 1.085
    const customRange = dtSh.getRange(anchor + AH_COLOURS.length, 1, 1, 29);
    customRange.setValues([customRow]);
    customRange.setBackground('#FFF2CC');                  // yellow — custom row (last of group)

    ovRow++;
    added++;
  }

  // ── Done ────────────────────────────────────────────────────────────────
  if (added === 0) {
    SpreadsheetApp.getUi().alert('ℹ️ No new parts found — all base PNs already exist in Overview.\n\nRaw tab has NOT been cleared.');
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const msg = `✅ Done!\n\nAdded ${added} new part group(s) to Overview.\nAdded ${added * (AH_COLOURS.length + 1)} rows to Details.\n\nClear the Raw tab now so it's ready for the next batch?`;
  const response = ui.alert('Import Complete', msg, ui.ButtonSet.YES_NO);

  if (response === ui.Button.YES) {
    // Keep rows 1-3 (title/instructions/col header) — clear data from row 4 down
    const lastRaw = rawSh.getLastRow();
    if (lastRaw > 3) {
      rawSh.getRange(4, 1, lastRaw - 3, rawSh.getLastColumn()).clearContent();
    }
    ui.alert('✅ Raw tab cleared. Paste your next batch whenever you\'re ready.');
  } else {
    ui.alert('Raw tab left as-is. Remember to clear it before your next import.');
  }
}

// ── PN Parser ─────────────────────────────────────────────────────────────────
// Handles: AH-630100-BLK, AH-630120-G-BLK, AH-630122-S-BLK, AH-630101 (custom)
function parsePn(pn) {
  pn = pn.toUpperCase().trim();
  if (!pn.startsWith('AH-')) return null;

  const colourCodes = ['AHGRY','BLK','BLU','GRN','RED'];

  // Check for colour suffix
  for (const cc of colourCodes) {
    if (pn.endsWith('-' + cc)) {
      const base = pn.slice(0, -(cc.length + 1));
      const material = base.endsWith('-G') ? 'Leather-G'
                     : base.endsWith('-S') ? 'Leather-S'
                     : 'Vinyl';
      return { basePn: base, material, colourCode: cc };
    }
  }

  // No colour suffix — it's a custom PN
  const material = pn.endsWith('-G') ? 'Leather-G'
                 : pn.endsWith('-S') ? 'Leather-S'
                 : 'Vinyl';
  return { basePn: pn, material, colourCode: 'CUSTOM' };
}

// Derive custom PN from base: AH-630100 → AH-630101
function deriveCustomPn(basePn) {
  // AH-640100      → AH-640101      (plain numeric, increment last segment)
  // AH-640120-G    → AH-640121-G    (material suffix, increment numeric before suffix)
  // AH-640122-S    → AH-640123-S
  const parts   = basePn.split('-');
  const last    = parts[parts.length - 1];
  const matSufx = /^[GS]$/.test(last);           // ends in -G or -S?
  const numIdx  = matSufx ? parts.length - 2 : parts.length - 1;
  const numPart = parts[numIdx];
  if (/^\d+$/.test(numPart)) {
    parts[numIdx] = String(parseInt(numPart) + 1).padStart(numPart.length, '0');
    return parts.join('-');
  }
  return basePn + '-CUSTOM'; // fallback
}

// ── External sheet loaders ────────────────────────────────────────────────────
function loadSage() {
  const sh   = SpreadsheetApp.openById(MP26_ID).getSheetByName('Sage Imported Prices');
  const data = sh.getDataRange().getValues();
  const map  = {};
  for (let i = 1; i < data.length; i++) {
    const pn = String(data[i][0]).trim().toUpperCase();
    if (pn) map[pn] = data[i];
  }
  return map;
}

// Loads all JS Snr rows (bare numeric PNs) as an array of {pn, desc}
function loadJsSrn() {
  const sh   = SpreadsheetApp.openById(MP26_ID).getSheetByName('Sage Imported Prices');
  const data = sh.getDataRange().getValues();
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < data.length; i++) {
    const pn   = String(data[i][0]).trim();
    const desc = String(data[i][1]).trim();
    if (pn && /^\d+$/.test(pn) && desc && !seen.has(pn)) {
      rows.push({ pn, desc });
      seen.add(pn);
    }
  }
  return rows;
}

// JS Snr colour map: words in description → AH colour code
const JS_SNR_COL_MAP = {
  'BLACK':'BLK','RED':'RED','BLUE':'BLU','DARK BLUE':'BLU',
  'GREY*':'GRY','GREY':'GRY','GREEN':'GRN','SUEDE GREEN':'GRN','SUEDE GRN':'GRN',
  'DARK GREEN':'GRN'
};

// Build formatted JS Snr range string for Overview col E
// e.g. "643301-643309 (Vinyl BN2: BLK=643301, RED=643302, BLU=643303, GRY=643304, GRN=643305)"
// Leather-G and Leather-S both map to JS Snr "Leather" — note added automatically
function buildJsSrnRange(jsSrnRows, modelPrefix, productType, material) {
  // Normalise material for JS Snr lookup
  const matSnr = material === 'Leather-G' || material === 'Leather-S' ? 'Leather'
               : material === 'Vinyl' ? 'Vinyl'
               : material;
  const noGS   = (material === 'Leather-G' || material === 'Leather-S');

  // Match rows: pn starts with modelPrefix, desc starts with "PRODUCTTYPE:MATSNR:"
  const prefix2 = modelPrefix; // e.g. "64"
  const typeKey = productType.toUpperCase();
  const matKey  = matSnr.toUpperCase();

  const matches = [];
  for (const row of jsSrnRows) {
    if (!row.pn.startsWith(prefix2)) continue;
    const d = row.desc.toUpperCase();
    // Must start with product type and contain the material
    if (!d.startsWith(typeKey)) continue;
    // Check material is in the description (second segment after first colon)
    const segs = row.desc.split(':');
    if (!segs[1] || segs[1].trim().toUpperCase() !== matKey) continue;
    // Skip State Colours / Custom rows
    const colPart = segs[2] ? segs[2].trim().toUpperCase() : '';
    if (colPart.includes('STATE') || colPart.includes('CUSTOM')) continue;
    matches.push(row);
  }

  if (!matches.length) return '';

  // Sort by PN
  matches.sort((a,b) => a.pn.localeCompare(b.pn, undefined, {numeric:true}));
  const pnMin = matches[0].pn;
  const pnMax = matches[matches.length-1].pn;

  // Build colour list: BLK=xxx, RED=xxx ...
  const colList = [];
  for (const row of matches) {
    const segs   = row.desc.split(':');
    const colRaw = segs[2] ? segs[2].trim().toUpperCase() : '';
    const ahCode = JS_SNR_COL_MAP[colRaw] || null;
    if (ahCode) colList.push(`${ahCode}=${row.pn}`);
  }

  // Extract model from last segment for the note
  const lastSeg  = matches[0].desc.split(':').slice(-1)[0].trim();
  const matLabel = matSnr;
  const note     = noGS ? ` — no G/S distinction in Snr system` : '';

  return `${pnMin}-${pnMax} (${matLabel} ${lastSeg}: ${colList.join(', ')})${note}`;
}

// Look up single JS Snr P/N for a Detailed row
// Uses the AH- Sage PN prefix + description segments (type, material, colour, model) — fuzzy match
// Falls back through progressively looser criteria
function jsSrnGet(jsSrnRows, sageDesc, ahPn) {
  if (!sageDesc) return '';

  // Try exact first
  const exact = sageDesc.toUpperCase().replace(/\s+/g,' ');
  for (const row of jsSrnRows) {
    if (row.desc.toUpperCase().replace(/\s+/g,' ') === exact) return row.pn;
  }

  // Extract segments from Sage desc: TYPE:MATERIAL:COLOUR:MODEL
  const segs    = sageDesc.split(':').map(s => s.trim().toUpperCase());
  const type    = segs[0] || '';
  const mat     = segs[1] || '';
  const colour  = segs[2] || '';
  const model   = segs[3] || '';

  // Model prefix from AH PN (e.g. AH-640100 → "64")
  const pfx = ahPn ? String(ahPn).replace(/^AH-/i,'').slice(0,2) : '';

  // Map Sage colour words to JS Snr equivalents
  const colAliases = {
    'BLACK':'BLACK','BLK':'BLACK',
    'RED':'RED',
    'BLUE':'BLUE','BLU':'BLUE','DARK BLUE':'BLUE',
    'GREY *':'GREY*','GREY':'GREY*','GRAY':'GREY*','AHGRY':'GREY*',
    'GREEN':'GREEN','GRN':'GREEN','SUEDE GREEN':'SUEDE GREEN','SUEDE GRN':'SUEDE GRN'
  };
  const colNorm = colAliases[colour] || colour;

  // Leather-G / Leather-S → Leather in JS Snr
  const matAliases = {'LEATHER-G':'LEATHER','LEATHER-S':'LEATHER','LEATHER G':'LEATHER','LEATHER S':'LEATHER'};
  const matNorm = matAliases[mat] || mat;

  // Score candidates
  let best = null, bestScore = 0;
  for (const row of jsSrnRows) {
    if (pfx && !row.pn.startsWith(pfx)) continue;
    const d = row.desc.toUpperCase();
    let score = 0;
    if (d.startsWith(type)) score += 4;
    if (d.includes(matNorm)) score += 3;
    if (d.includes(colNorm) || (colNorm && d.includes(colNorm.split(' ')[0]))) score += 2;
    if (model && d.includes(model)) score += 1;
    if (score > bestScore) { bestScore = score; best = row.pn; }
  }
  return bestScore >= 7 ? best : ''; // require type+material+colour match minimum
}

function loadAhOverview() {
  const sh   = SpreadsheetApp.openById(PL_ID).getSheetByName('AH - Main Overview');
  const data = sh.getDataRange().getValues();
  const map  = {};
  for (let i = 1; i < data.length; i++) {
    const pn = String(data[i][7]).trim().toLowerCase();
    if (pn) map[pn] = data[i];
  }
  return map;
}

function sageGet(map, pn, col) {
  const row = map[pn.toUpperCase()] || map[pn];
  return row && row[col] != null ? String(row[col]).trim() : '';
}

function ahGet(map, pn, col) {
  const row = map[pn.toLowerCase()] || map[pn];
  return row && row[col] != null ? String(row[col]).trim() : '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
