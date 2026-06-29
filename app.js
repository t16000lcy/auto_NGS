const COLUMN_FALLBACK = {
  source: 0,
  sample: 9,
  variantDescription: 19,
  transcript: 16,
  codingChange: 17,
  cnvTypeA: 14,
  cnvTypeB: 15,
  maf: [27, 28, 29, 30],
  cnvScore: 39,
};

const state = {
  headers: [],
  rows: [],
  columns: {},
  files: {
    snv: null,
    indel: null,
  },
  selectedSample: "",
  result: null,
  vepStatus: null,
  vepRun: null,
  interpretation: null,
};

const els = {
  snvUpload: document.querySelector("#snv-upload"),
  indelUpload: document.querySelector("#indel-upload"),
  mvpSnvUpload: document.querySelector("#mvp-snv-upload"),
  mvpIndelUpload: document.querySelector("#mvp-indel-upload"),
  snvFileLabel: document.querySelector("#snv-file-label"),
  indelFileLabel: document.querySelector("#indel-file-label"),
  sampleSelect: document.querySelector("#sample-select"),
  runAnalysis: document.querySelector("#run-analysis"),
  exportExcel: document.querySelector("#export-excel"),
  detectedColumns: document.querySelector("#detected-columns"),
  progressItems: [...document.querySelectorAll("#progress-list li")],
  vepOutput: document.querySelector("#vep-output"),
  previewNote: document.querySelector("#preview-note"),
  vepNote: document.querySelector("#vep-note"),
  previewTable: document.querySelector("#preview-table"),
  checkVepStatus: document.querySelector("#check-vep-status"),
  runVep: document.querySelector("#run-vep"),
  vepStatusList: document.querySelector("#vep-status-list"),
  vepServerNote: document.querySelector("#vep-server-note"),
  vepRunNote: document.querySelector("#vep-run-note"),
  vepResultTable: document.querySelector("#vep-result-table"),
  vepCommandOutput: document.querySelector("#vep-command-output"),
  buildInterpretation: document.querySelector("#build-interpretation"),
  exportInterpretation: document.querySelector("#export-interpretation"),
  interpretationNote: document.querySelector("#interpretation-note"),
  interpretationTableNote: document.querySelector("#interpretation-table-note"),
  interpretationTable: document.querySelector("#interpretation-table"),
  manualReviewNote: document.querySelector("#manual-review-note"),
  manualReviewList: document.querySelector("#manual-review-list"),
  dbVersionList: document.querySelector("#db-version-list"),
  dbVersionNote: document.querySelector("#db-version-note"),
  operatorName: document.querySelector("#operator-name"),
  qcNote: document.querySelector("#qc-note"),
  saveAudit: document.querySelector("#save-audit"),
  auditNote: document.querySelector("#audit-note"),
  auditList: document.querySelector("#audit-list"),
  reportCandidateNote: document.querySelector("#report-candidate-note"),
  reportCandidateTable: document.querySelector("#report-candidate-table"),
  metrics: {
    total: document.querySelector("#metric-total"),
    sample: document.querySelector("#metric-sample"),
    synonymous: document.querySelector("#metric-synonymous"),
    maf: document.querySelector("#metric-maf"),
    ratio: document.querySelector("#metric-ratio"),
    vep: document.querySelector("#metric-vep"),
    pathogenic: document.querySelector("#metric-pathogenic"),
    vus: document.querySelector("#metric-vus"),
    benign: document.querySelector("#metric-benign"),
    recheck: document.querySelector("#metric-recheck"),
    manual: document.querySelector("#metric-manual"),
    cnvCandidates: document.querySelector("#metric-cnv-candidates"),
  },
};

document.querySelectorAll("[data-scroll-target]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.scrollTarget}`)?.scrollIntoView({ behavior: "smooth" });
  });
});

els.snvUpload?.addEventListener("change", (event) => handleVcfFileChange("snv", event.target.files?.[0]));
els.indelUpload?.addEventListener("change", (event) => handleVcfFileChange("indel", event.target.files?.[0]));
els.mvpSnvUpload?.addEventListener("change", (event) => handleVcfFileChange("snv", event.target.files?.[0]));
els.mvpIndelUpload?.addEventListener("change", (event) => handleVcfFileChange("indel", event.target.files?.[0]));

els.sampleSelect?.addEventListener("change", () => {
  state.selectedSample = els.sampleSelect.value;
  setProgress(2);
  updateMetric("sample", countSampleRows());
  resetResults();
});

els.runAnalysis?.addEventListener("click", runPhaseOne);
els.exportExcel?.addEventListener("click", exportExcelWorkbook);
els.checkVepStatus?.addEventListener("click", checkVepStatus);
els.runVep?.addEventListener("click", runLocalVep);
els.buildInterpretation?.addEventListener("click", buildInterpretationTable);
els.exportInterpretation?.addEventListener("click", exportInterpretationWorkbook);
els.saveAudit?.addEventListener("click", saveAuditLog);

const VCF_HEADERS = [
  "Source",
  "File",
  "CHROM",
  "POS",
  "ID",
  "REF",
  "ALT",
  "QUAL",
  "FILTER",
  "Sample Adapter",
  "Variant Description",
  "Gene",
  "Transcript",
  "Coding Change",
  "Protein Change",
  "Ratio",
  "DP",
  "ALTDP",
  "SCORE1",
  "DBSNP_AF",
  "EXAC_AF",
  "KG_AF",
  "CNV Type",
  "CNV Score",
  "COSMIC_ID",
  "COSMIC_COUNT",
  "COSMIC_SITES",
  "TCGA",
  "VEP Location Input",
  "INFO",
];

function handleVcfFileChange(kind, file) {
  state.files[kind] = file || null;
  if (kind === "snv" && els.snvFileLabel) {
    els.snvFileLabel.textContent = file ? file.name : "選擇 snv-Unfiltered.vcf";
  }
  if (kind === "indel" && els.indelFileLabel) {
    els.indelFileLabel.textContent = file ? file.name : "選擇 indel-Unfiltered.vcf";
  }
  loadVcfPair();
}

async function loadVcfPair() {
  const entries = [
    ["SNV", state.files.snv],
    ["INDEL", state.files.indel],
  ].filter(([, file]) => file);
  if (!entries.length) return;

  try {
    const parsedFiles = await Promise.all(
      entries.map(async ([source, file]) => ({ source, fileName: file.name, text: await readFileText(file) })),
    );
    const rows = parsedFiles.flatMap((entry) => parseVcf(entry.text, entry.source, entry.fileName));
    if (!rows.length) {
      alert("VCF 內容沒有可分析的 variant，請確認檔案。");
      return;
    }

    state.headers = VCF_HEADERS;
    state.rows = rows;
    state.columns = detectColumns(state.headers);
    state.result = null;
    state.vepRun = null;
    state.interpretation = null;
    state.selectedSample = "";

    populateSamples();
    renderDetectedColumns();
    resetResults();
    updateMetric("total", state.rows.length);
    setProgress(1);
  } catch (error) {
    alert(`VCF 讀取失敗：${error.message || error}`);
  }
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsText(file, "utf-8");
  });
}

function parseVcf(text, source, fileName) {
  const rows = [];
  text.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const fields = line.split("\t");
    if (fields.length < 8) return;
    const [chrom, pos, id, ref, alt, qual, filter, info] = fields;
    const infoMap = parseVcfInfo(info);
    const ann = parseAnn(infoMap.ANN);
    const transcript = firstInfoValue(infoMap.TRANSCRIPT) || ann.transcript;
    const coding = firstInfoValue(infoMap.CDNA) || ann.codingChange;
    const gene = firstInfoValue(infoMap.GENE) || ann.gene;
    const sample = firstInfoValue(infoMap.SID) || fields[9] || source;
    rows.push([
      source,
      fileName,
      chrom,
      pos,
      id,
      ref,
      alt,
      qual,
      filter,
      sample,
      ann.consequence,
      gene,
      transcript,
      coding,
      firstInfoValue(infoMap.AACID) || ann.proteinChange,
      firstInfoValue(infoMap.AF),
      firstInfoValue(infoMap.DP),
      firstInfoValue(infoMap.ALTDP),
      firstInfoValue(infoMap.SCORE1),
      firstInfoValue(infoMap.DBSNP_AF),
      firstInfoValue(infoMap.EXAC_AF),
      firstInfoValue(infoMap.KG_AF),
      infoMap.CNV || infoMap.INDEL ? source : "",
      firstInfoValue(infoMap.CNV_SCORE) || "",
      firstInfoValue(infoMap.COSMIC_ID),
      firstInfoValue(infoMap.COSMIC_COUNT),
      firstInfoValue(infoMap.COSMIC_SITES),
      firstInfoValue(infoMap.TCGA),
      buildVepLocationInput(chrom, pos, ref, alt),
      info,
    ]);
  });
  return rows;
}

function parseVcfInfo(info) {
  const map = {};
  clean(info)
    .split(";")
    .filter(Boolean)
    .forEach((part) => {
      const equals = part.indexOf("=");
      if (equals === -1) {
        map[part] = true;
      } else {
        map[part.slice(0, equals)] = part.slice(equals + 1);
      }
    });
  return map;
}

function parseAnn(value) {
  const first = firstInfoValue(value);
  const parts = first.split("|");
  return {
    consequence: parts[1] || "",
    gene: parts[3] || "",
    transcript: parts[6] || "",
    codingChange: parts[9] || "",
    proteinChange: parts[10] || "",
  };
}

function firstInfoValue(value) {
  return clean(value).split(",")[0] || "";
}

function buildVepLocationInput(chrom, pos, ref, alt) {
  const normalizedChrom = clean(chrom).replace(/^chr/i, "");
  return `${normalizedChrom} ${pos} ${pos} ${clean(ref)}/${clean(alt)} +`;
}

function detectColumns(headers) {
  const find = (...terms) => {
    const normalizedTerms = terms.map(normalize);
    const index = headers.findIndex((header) => {
      const value = normalize(header);
      return normalizedTerms.every((term) => value.includes(term));
    });
    return index >= 0 ? index : null;
  };
  const findAll = (term) => {
    const needle = normalize(term);
    return headers
      .map((header, index) => ({ header: normalize(header), index }))
      .filter(({ header }) => header.includes(needle))
      .map(({ index }) => index);
  };

  const ratio =
    find("ratio", "variant") ??
    find("variant", "frequency") ??
    find("vaf") ??
    find("allele", "fraction");
  const mafByHeader = headers
    .map((header, index) => ({ header: normalize(header), index }))
    .filter(({ header }) => {
      const isFrequency =
        header.includes("frequency") ||
        header.includes("maf") ||
        header.includes("minor allele") ||
        /(^| )((dbsnp|exac|kg|gnomad) )?af$/.test(header);
      const isRatio = header.includes("ratio") || header.includes("vaf") || header.includes("variant frequency");
      return isFrequency && !isRatio;
    })
    .slice(0, 4)
    .map(({ index }) => index);

  return {
    sample: find("sample", "adapter") ?? find("adapter") ?? find("sample") ?? COLUMN_FALLBACK.sample,
    variantDescription:
      find("variant", "description") ?? find("description") ?? COLUMN_FALLBACK.variantDescription,
    transcript: find("transcript") ?? COLUMN_FALLBACK.transcript,
    codingChange: find("coding", "change") ?? find("coding") ?? find("hgvs") ?? COLUMN_FALLBACK.codingChange,
    cnvTypeA: find("cnv", "type") ?? COLUMN_FALLBACK.cnvTypeA,
    cnvTypeB: find("source") ?? COLUMN_FALLBACK.cnvTypeB,
    maf: mafByHeader.length ? mafByHeader : COLUMN_FALLBACK.maf,
    cnvScore: find("cnv", "score") ?? COLUMN_FALLBACK.cnvScore,
    vepLocationInput: find("vep", "location", "input"),
    ratio,
    cosmic: findAll("cosmic"),
    tcga: findAll("tcga"),
  };
}

function populateSamples() {
  const col = state.columns.sample;
  const samples = [...new Set(state.rows.map((row) => clean(row[col])).filter(Boolean))].sort();
  els.sampleSelect.innerHTML = "";

  if (!samples.length) {
    els.sampleSelect.disabled = true;
    els.sampleSelect.innerHTML = "<option>未偵測到 Sample Adapter</option>";
    els.runAnalysis.disabled = true;
    return;
  }

  samples.forEach((sample) => {
    const option = document.createElement("option");
    option.value = sample;
    option.textContent = sample;
    els.sampleSelect.appendChild(option);
  });
  els.sampleSelect.disabled = false;
  els.runAnalysis.disabled = false;
  state.selectedSample = samples[0];
  updateMetric("sample", countSampleRows());
}

function runPhaseOne() {
  if (!state.rows.length || !state.selectedSample) return;

  const sampleRows = state.rows.filter((row) => clean(row[state.columns.sample]) === state.selectedSample);
  const nonSynonymous = sampleRows.filter((row) => !isSynonymous(row));
  const mafPassed = nonSynonymous.filter((row) => passesMaf(row));
  const ratioPassed = mafPassed.filter((row) => passesRatio(row));
  const lowRatioRows = mafPassed.filter((row) => isLowRatioRecheckRange(row));
  const interpretationRows = uniqueRows([...ratioPassed, ...lowRatioRows]);
  const withDerived = interpretationRows.map((row) => ({
    row,
    vepInput: buildVepInput(row),
    cnvFlag: detectCnv(row),
    lowRatioRecheck: isLowRatioRecheckRange(row),
  }));
  const vepInputs = [...new Set(withDerived.map((item) => item.vepInput).filter(Boolean))];

  state.result = { sampleRows, nonSynonymous, mafPassed, ratioPassed, lowRatioRows, withDerived, vepInputs };

  updateMetric("sample", sampleRows.length);
  updateMetric("synonymous", nonSynonymous.length);
  updateMetric("maf", mafPassed.length);
  updateMetric("ratio", ratioPassed.length);
  updateMetric("vep", vepInputs.length);
  renderPreview(withDerived);
  renderVepInputs(vepInputs);
  els.exportExcel.disabled = false;
  els.buildInterpretation.disabled = false;
  els.runVep.disabled = !(state.vepStatus?.ok && vepInputs.length);
  setProgress(5);
}

function isSynonymous(row) {
  return normalize(row[state.columns.variantDescription]).includes("synonymous");
}

function passesMaf(row) {
  return state.columns.maf.every((index) => {
    const value = clean(row[index]);
    if (!value || /^(n\/a|na|nan|null|-)$/i.test(value)) return true;
    const numeric = parseFrequency(value);
    return Number.isNaN(numeric) ? true : numeric < 1;
  });
}

function passesRatio(row) {
  if (state.columns.ratio == null) return true;
  const value = clean(row[state.columns.ratio]);
  if (!value) return true;
  const numeric = parseFrequency(value);
  return Number.isNaN(numeric) ? true : numeric >= 0.5;
}

function isLowRatioRecheckRange(row) {
  if (state.columns.ratio == null) return false;
  const value = clean(row[state.columns.ratio]);
  if (!value) return false;
  const numeric = parseFrequency(value);
  return Number.isFinite(numeric) && numeric >= 0.1 && numeric < 0.5;
}

function detectCnv(row) {
  const typeText = `${row[state.columns.cnvTypeA] || ""} ${row[state.columns.cnvTypeB] || ""}`;
  const hasCnv = normalize(typeText).includes("cnv");
  const score = parseFloat(clean(row[state.columns.cnvScore]).replace(/[^\d.-]/g, ""));
  return { hasCnv, score: Number.isFinite(score) ? score : "", pathogenic: hasCnv && score > 5 };
}

function buildVepInput(row) {
  const transcript = firstValue(row[state.columns.transcript]);
  const coding = firstValue(row[state.columns.codingChange]);
  return transcript && coding ? `${transcript}:${coding}` : "";
}

function renderPreview(items) {
  const preferred = [
    state.columns.sample,
    state.columns.variantDescription,
    state.columns.transcript,
    state.columns.codingChange,
    state.columns.ratio,
    state.columns.cnvScore,
  ].filter((value, index, array) => value != null && array.indexOf(value) === index);

  clearTable(els.previewTable);
  const headerRow = document.createElement("tr");
  [...preferred.map((index) => state.headers[index]), "CNV flag", "VEP input"].forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header || "";
    headerRow.appendChild(th);
  });
  els.previewTable.tHead.appendChild(headerRow);

  items.slice(0, 60).forEach((item) => {
    const tr = document.createElement("tr");
    preferred.forEach((index) => appendCell(tr, item.row[index] || ""));
    appendCell(
      tr,
      item.cnvFlag.pathogenic ? `CNV score ${item.cnvFlag.score} > 5` : item.cnvFlag.hasCnv ? "CNV" : "",
    );
    appendCell(tr, item.vepInput);
    els.previewTable.tBodies[0].appendChild(tr);
  });
  els.previewNote.textContent = `顯示 ${Math.min(items.length, 60)} / ${items.length} 筆`;
}

function renderVepInputs(inputs) {
  els.vepOutput.value = inputs.join("\n");
  els.vepNote.textContent = `${inputs.length} 筆 unique VEP input`;
}

async function checkVepStatus() {
  els.vepServerNote.textContent = "檢查中...";
  els.checkVepStatus.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/vep/status"), { headers: apiHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    state.vepStatus = status;
    renderVepStatus(status);
    renderDatabaseVersions(status.config);
    els.vepServerNote.textContent = status.ok ? "環境可執行" : "環境尚未完成";
    els.runVep.disabled = !(status.ok && state.result?.vepInputs?.length);
  } catch (error) {
    state.vepStatus = null;
    els.vepServerNote.textContent = "localhost API 未啟動";
    els.vepStatusList.innerHTML = `
      <div class="vep-check fail">
        <i></i>
        <div>
          <strong>無法連線到本機 API</strong>
          <span>請用 start_cmuhch_vep.ps1 啟動網站，再用 http://127.0.0.1:8765/ 開啟。</span>
        </div>
      </div>`;
    els.runVep.disabled = true;
  } finally {
    els.checkVepStatus.disabled = false;
  }
}

async function runLocalVep() {
  const inputs = state.result?.vepInputs || [];
  if (!inputs.length) {
    alert("請先完成階段 1，產生 VEP input 清單。");
    return;
  }
  els.runVep.disabled = true;
  els.vepRunNote.textContent = "VEP 執行中...";
  els.vepCommandOutput.textContent = "Running local VEP...";
  try {
    const response = await fetch(apiUrl("/api/vep/run"), {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ inputs }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    state.vepRun = result;
    renderVepRun(result);
    els.buildInterpretation.disabled = !state.result?.withDerived?.length;
  } catch (error) {
    els.vepRunNote.textContent = "VEP 執行失敗";
    els.vepCommandOutput.textContent = String(error);
  } finally {
    els.runVep.disabled = !(state.vepStatus?.ok && inputs.length);
  }
}

function renderVepStatus(status) {
  els.vepStatusList.innerHTML = status.checks
    .map(
      (check) => `
        <div class="vep-check ${check.ok ? "ok" : "fail"}">
          <i></i>
          <div>
            <strong>${escapeHtml(check.name)}</strong>
            <span>${escapeHtml(check.detail || "")}</span>
          </div>
        </div>`,
    )
    .join("");
}

function renderDatabaseVersions(config) {
  const versions = config?.database_versions || {};
  const plugins = config?.plugins || {};
  const items = [
    ...Object.entries(versions).map(([key, value]) => ({ key, value })),
    ["dbNSFP plugin", plugins.dbnsfp?.enabled ? `${plugins.dbnsfp.version}; ${plugins.dbnsfp.host_path}` : "disabled"],
    ["CADD plugin", plugins.cadd?.enabled ? `${plugins.cadd.version}; SNV/InDel configured` : "disabled"],
  ].map((entry) => (Array.isArray(entry) ? { key: entry[0], value: entry[1] } : entry));

  els.dbVersionList.innerHTML = items
    .map(
      (item) => `
        <div class="version-item">
          <strong>${escapeHtml(item.key)}</strong>
          <span>${escapeHtml(item.value)}</span>
        </div>`,
    )
    .join("");
  els.dbVersionNote.textContent = `VEP ${versions.vep_release || "unknown"} / ${versions.assembly || ""}`;
}

function renderVepRun(result) {
  els.vepRunNote.textContent = result.ok
    ? `${result.record_count || 0} 筆 VEP annotation`
    : `VEP 未完成：${firstErrorLine(result.stderr) || "請查看 stderr"}`;
  els.vepCommandOutput.textContent = [
    `Job: ${result.job_id || ""}`,
    `Output: ${result.output_path || ""}`,
    "",
    "Command:",
    (result.command || []).join(" "),
    "",
    "STDOUT:",
    result.stdout || "",
    "",
    "STDERR:",
    result.stderr || "",
  ].join("\n");
  renderVepResultTable(result.records || []);
}

function firstErrorLine(value) {
  return clean(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("MSG:") || line.includes("ERROR:") || line.includes("EXCEPTION"));
}

function renderVepResultTable(records) {
  clearTable(els.vepResultTable);
  if (!records.length) return;
  const preferred = [
    "Uploaded_variation",
    "Location",
    "Allele",
    "Gene",
    "Feature",
    "Feature_type",
    "Consequence",
    "SYMBOL",
    "HGVSc",
    "HGVSp",
    "SIFT",
    "PolyPhen",
    "Existing_variation",
    "Extra",
  ].filter((key) => key in records[0]);
  renderObjectTable(els.vepResultTable, records.slice(0, 80), preferred.length ? preferred : Object.keys(records[0]).slice(0, 14));
}

function buildInterpretationTable() {
  if (!state.result?.withDerived?.length) {
    alert("請先完成階段 1 分析。");
    return;
  }

  const vepIndex = indexVepRecords(state.vepRun?.records || []);
  const rows = state.result.withDerived.map((item) => {
    const candidates = vepIndex.get(item.vepInput) || [];
    const transcriptChoice = chooseTranscript(candidates);
    const inputEvidence = collectInputEvidence(item.row);
    const evidence = collectEvidence(item, transcriptChoice.record, inputEvidence);
    const classification = classifyVariant(item, evidence);
    return { item, vepInput: item.vepInput, candidates, inputEvidence, evidence, classification, ...transcriptChoice };
  });

  state.interpretation = rows;
  renderInterpretation(rows);
  els.exportInterpretation.disabled = false;
}

function indexVepRecords(records) {
  const map = new Map();
  records.forEach((record) => {
    const key = record.Uploaded_variation || record.Input || record["#Uploaded_variation"] || "";
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  });
  return map;
}

function chooseTranscript(records) {
  if (!records.length) return { record: null, selectedTranscript: "", transcriptStatus: "VEP 尚無結果" };
  const withFeature = records.map((record) => ({
    record,
    feature: clean(record.Feature || record.Transcript || record.RefSeq || ""),
    extra: clean(record.Extra || ""),
  }));
  const nm = withFeature.filter((item) => item.feature.startsWith("NM_"));
  const nonXm = withFeature.filter((item) => !item.feature.startsWith("XM_"));
  const pool = nm.length ? nm : nonXm.length ? nonXm : withFeature;
  const ranked = [...pool].sort((a, b) => transcriptScore(b) - transcriptScore(a));
  const best = ranked[0];
  const manual =
    nm.length > 1 ||
    !best.feature.startsWith("NM_") ||
    (ranked.length > 1 && transcriptScore(ranked[0]) === transcriptScore(ranked[1]));
  return {
    record: best.record,
    selectedTranscript: best.feature,
    transcriptStatus: manual ? "需人工確認 transcript" : "自動選擇",
  };
}

function transcriptScore(item) {
  let score = 0;
  if (item.feature.startsWith("NM_")) score += 100;
  if (item.feature.startsWith("XM_")) score -= 100;
  if (/MANE_SELECT/i.test(item.extra)) score += 30;
  if (/CANONICAL=YES/i.test(item.extra)) score += 20;
  if (/biotype=protein_coding/i.test(item.extra)) score += 5;
  return score;
}

function collectInputEvidence(row) {
  return {
    cosmic: valuesFromColumns(row, state.columns.cosmic),
    tcga: valuesFromColumns(row, state.columns.tcga),
  };
}

function valuesFromColumns(row, columns = []) {
  return columns.map((index) => clean(row[index])).filter((value) => value && !/^(n\/a|na|nan|null|-|0)$/i.test(value));
}

function collectEvidence(item, record, inputEvidence) {
  const text = [
    inputEvidence.cosmic.join(" "),
    inputEvidence.tcga.join(" "),
    record?.Consequence || "",
    record?.SIFT || "",
    record?.PolyPhen || "",
    record?.Existing_variation || "",
    record?.Extra || "",
  ].join(" ");
  const lower = text.toLowerCase();
  const cadd = extractNumber(text.match(/CADD(?:_PHRED|_phred)?=([\d.]+)/i)?.[1] || "");
  return {
    hasCosmic: inputEvidence.cosmic.length > 0,
    hasTcga: inputEvidence.tcga.length > 0,
    clinvarPathogenic: /clin_sig=[^;\t]*(pathogenic|likely_pathogenic)/i.test(text),
    clinvarBenign: /clin_sig=[^;\t]*(benign|likely_benign)/i.test(text),
    siftDeleterious: lower.includes("deleterious"),
    polyphenDamaging: lower.includes("probably_damaging") || lower.includes("probably damaging"),
    caddHigh: Number.isFinite(cadd) && cadd >= 20,
    cadd,
    highImpact: /(stop_gained|frameshift_variant|splice_acceptor|splice_donor|start_lost|stop_lost)/i.test(text),
    synonymous: lower.includes("synonymous_variant"),
  };
}

function classifyVariant(item, evidence) {
  if (item.lowRatioRecheck) {
    return { label: "Recheck needed", key: "recheck", reason: "Ratio 0.1%-0.5%，需依 pathogenic evidence 複核" };
  }
  if (
    item.cnvFlag.pathogenic ||
    evidence.clinvarPathogenic ||
    evidence.highImpact ||
    evidence.caddHigh ||
    evidence.hasCosmic ||
    evidence.hasTcga ||
    (evidence.siftDeleterious && evidence.polyphenDamaging)
  ) {
    return { label: "Pathogenic candidate", key: "pathogenic", reason: evidenceReason(item, evidence) };
  }
  if (evidence.clinvarBenign || evidence.synonymous) {
    return { label: "Benign likely", key: "benign", reason: evidenceReason(item, evidence) };
  }
  return { label: "VUS / uncertain", key: "vus", reason: evidenceReason(item, evidence) || "目前證據不足" };
}

function evidenceReason(item, evidence) {
  const reasons = [];
  if (item.cnvFlag.pathogenic) reasons.push(`CNV score ${item.cnvFlag.score} > 5`);
  if (evidence.clinvarPathogenic) reasons.push("ClinVar pathogenic");
  if (evidence.clinvarBenign) reasons.push("ClinVar benign");
  if (evidence.highImpact) reasons.push("High-impact consequence");
  if (evidence.caddHigh) reasons.push(`CADD PHRED ${evidence.cadd} >= 20`);
  if (evidence.siftDeleterious) reasons.push("SIFT deleterious");
  if (evidence.polyphenDamaging) reasons.push("PolyPhen probably damaging");
  if (evidence.hasCosmic) reasons.push("COSMIC evidence");
  if (evidence.hasTcga) reasons.push("TCGA evidence");
  return reasons.join("; ");
}

function renderInterpretation(rows) {
  const counts = { pathogenic: 0, vus: 0, benign: 0, recheck: 0, manual: 0, cnvCandidates: 0 };
  rows.forEach((row) => {
    counts[row.classification.key] += 1;
    if (row.transcriptStatus.includes("人工")) counts.manual += 1;
    if (row.item.cnvFlag.pathogenic) counts.cnvCandidates += 1;
  });
  updateMetric("pathogenic", counts.pathogenic);
  updateMetric("vus", counts.vus);
  updateMetric("benign", counts.benign);
  updateMetric("recheck", counts.recheck);
  updateMetric("manual", counts.manual);
  updateMetric("cnvCandidates", counts.cnvCandidates);
  renderInterpretationTable(rows);
  renderManualReview(rows);
  renderReportCandidates(rows);
  els.interpretationNote.textContent = `已合併 ${rows.length} 筆 variant；VEP records: ${state.vepRun?.record_count || 0}`;
  els.saveAudit.disabled = false;
}

function renderInterpretationTable(rows) {
  clearTable(els.interpretationTable);
  const headers = [
    "Classification",
    "Reason",
    "VEP input",
    "Selected transcript",
    "Transcript status",
    "Gene",
    "Symbol",
    "Consequence",
    "HGVSc",
    "HGVSp",
    "SIFT",
    "PolyPhen",
    "COSMIC",
    "TCGA",
    "CNV flag",
  ];
  const headRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headRow.appendChild(th);
  });
  els.interpretationTable.tHead.appendChild(headRow);

  rows.forEach((row) => {
    const record = row.record || {};
    const tr = document.createElement("tr");
    const values = [
      row.classification.label,
      row.classification.reason,
      row.vepInput,
      row.selectedTranscript,
      row.transcriptStatus,
      record.Gene || "",
      record.SYMBOL || "",
      record.Consequence || "",
      record.HGVSc || "",
      record.HGVSp || "",
      record.SIFT || "",
      record.PolyPhen || "",
      row.inputEvidence.cosmic.join("; "),
      row.inputEvidence.tcga.join("; "),
      row.item.cnvFlag.pathogenic ? `CNV score ${row.item.cnvFlag.score} > 5` : row.item.cnvFlag.hasCnv ? "CNV" : "",
    ];
    values.forEach((value, index) => {
      const td = document.createElement("td");
      if (index === 0) {
        const pill = document.createElement("span");
        pill.className = `classification-pill classification-${row.classification.key}`;
        pill.textContent = value;
        td.appendChild(pill);
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    });
    els.interpretationTable.tBodies[0].appendChild(tr);
  });
  els.interpretationTableNote.textContent = `${rows.length} 筆`;
}

function renderManualReview(rows) {
  const items = rows.filter((row) => row.transcriptStatus.includes("人工") || row.classification.key === "recheck");
  els.manualReviewNote.textContent = `${items.length} 筆需確認`;
  if (!items.length) {
    els.manualReviewList.innerHTML = "<p>目前沒有需要人工確認的 transcript 或 recheck 項目。</p>";
    return;
  }
  els.manualReviewList.innerHTML = items
    .map(
      (row) => `
        <div class="manual-item">
          <strong>${escapeHtml(row.vepInput || "No VEP input")}</strong>
          <span>${escapeHtml(row.transcriptStatus)}</span>
          <span>${escapeHtml(row.classification.label)}：${escapeHtml(row.classification.reason)}</span>
          <span>候選 transcript：${escapeHtml(row.candidates.map((record) => record.Feature || "").filter(Boolean).join(" / "))}</span>
        </div>`,
    )
    .join("");
}

function renderReportCandidates(rows) {
  const candidates = rows.filter((row) => row.classification.key === "pathogenic" || row.classification.key === "recheck");
  clearTable(els.reportCandidateTable);
  const headers = ["Classification", "Reason", "VEP input", "Transcript", "Symbol", "Consequence", "COSMIC", "TCGA", "CNV"];
  const head = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    head.appendChild(th);
  });
  els.reportCandidateTable.tHead.appendChild(head);

  candidates.forEach((row) => {
    const record = row.record || {};
    const tr = document.createElement("tr");
    [
      row.classification.label,
      row.classification.reason,
      row.vepInput,
      row.selectedTranscript,
      record.SYMBOL || "",
      record.Consequence || "",
      row.inputEvidence.cosmic.join("; "),
      row.inputEvidence.tcga.join("; "),
      row.item.cnvFlag.pathogenic ? `CNV score ${row.item.cnvFlag.score} > 5` : "",
    ].forEach((value) => appendCell(tr, value));
    els.reportCandidateTable.tBodies[0].appendChild(tr);
  });
  els.reportCandidateNote.textContent = `${candidates.length} 筆候選`;
}

async function saveAuditLog() {
  if (!state.interpretation?.length) {
    alert("請先產生初步判讀表。");
    return;
  }

  const reportCandidates = state.interpretation
    .filter((row) => row.classification.key === "pathogenic" || row.classification.key === "recheck")
    .map((row) => ({
      classification: row.classification.label,
      reason: row.classification.reason,
      vep_input: row.vepInput,
      transcript: row.selectedTranscript,
      transcript_status: row.transcriptStatus,
      symbol: row.record?.SYMBOL || "",
      consequence: row.record?.Consequence || "",
      cosmic: row.inputEvidence.cosmic,
      tcga: row.inputEvidence.tcga,
      cnv_flag: row.item.cnvFlag,
    }));
  const manualReview = state.interpretation
    .filter((row) => row.transcriptStatus.includes("人工") || row.classification.key === "recheck")
    .map((row) => ({
      vep_input: row.vepInput,
      transcript_status: row.transcriptStatus,
      classification: row.classification.label,
      reason: row.classification.reason,
      candidates: row.candidates.map((record) => record.Feature || "").filter(Boolean),
    }));

  const summary = {
    total_variants: state.rows.length,
    selected_sample_variants: state.result?.sampleRows?.length || 0,
    filtered_variants: state.result?.withDerived?.length || 0,
    vep_inputs: state.result?.vepInputs?.length || 0,
    vep_records: state.vepRun?.record_count || 0,
    interpretation_rows: state.interpretation.length,
    report_candidates: reportCandidates.length,
    manual_review: manualReview.length,
  };

  const payload = {
    operator: els.operatorName.value,
    case_id: document.querySelector("#case-id")?.value || "",
    panel: document.querySelector("#panel-name")?.value || "",
    sample_adapter: state.selectedSample,
    parameters: {
      maf: "<1% or N/A",
      ratio: ">=0.5%; 0.1%-0.5% marked recheck",
      transcript_selection: "Prefer NM_; deprioritize XM_; MANE/canonical score",
      assembly: "GRCh38",
    },
    qc: {
      note: els.qcNote.value,
      phase1_complete: Boolean(state.result),
      phase2_vep_records: state.vepRun?.record_count || 0,
      phase3_complete: Boolean(state.interpretation),
    },
    summary,
    report_candidates: reportCandidates,
    manual_review: manualReview,
  };

  els.saveAudit.disabled = true;
  els.auditNote.textContent = "保存中...";
  try {
    const response = await fetch(apiUrl("/api/audit/save"), {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    els.auditNote.textContent = result.ok ? `已保存 ${result.audit_id}` : "保存失敗";
    await loadAuditList();
  } catch (error) {
    els.auditNote.textContent = "localhost API 未啟動";
  } finally {
    els.saveAudit.disabled = false;
  }
}

async function loadAuditList() {
  try {
    const response = await fetch(apiUrl("/api/audit/list"), { headers: apiHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result.records?.length) {
      els.auditList.innerHTML = "<p>尚無 audit log。</p>";
      return;
    }
    els.auditList.innerHTML = result.records
      .map(
        (record) => `
          <div class="audit-item">
            <strong>${escapeHtml(record.case_id || record.audit_id)}</strong>
            <span>${escapeHtml(record.created_at)} / ${escapeHtml(record.operator || "operator 未填")}</span>
            <span>Sample: ${escapeHtml(record.sample_adapter || "")}</span>
            <span>${escapeHtml(record.path || "")}</span>
          </div>`,
      )
      .join("");
  } catch {
    els.auditList.innerHTML = "<p>無法讀取 audit log；請確認 localhost API 已啟動。</p>";
  }
}

function exportExcelWorkbook() {
  if (!state.result) return;
  const rows = state.result.withDerived.map((item) => {
    const copy = {};
    state.headers.forEach((header, index) => {
      copy[header] = item.row[index] || "";
    });
    copy.CMUHCH_CNV_Flag = item.cnvFlag.pathogenic
      ? `CNV score ${item.cnvFlag.score} > 5`
      : item.cnvFlag.hasCnv
        ? "CNV"
        : "";
    copy.CMUHCH_Low_Ratio_Recheck = item.lowRatioRecheck ? "Ratio 0.1%-0.5%" : "";
    copy.CMUHCH_VEP_Input = item.vepInput;
    return copy;
  });
  const summary = [
    ["Case ID", document.querySelector("#case-id")?.value || ""],
    ["Panel", document.querySelector("#panel-name")?.value || ""],
    ["Sample Adapter", state.selectedSample],
    ["Original variants", state.rows.length],
    ["Selected sample", state.result.sampleRows.length],
    ["After excluding synonymous", state.result.nonSynonymous.length],
    ["After MAF <1% or N/A", state.result.mafPassed.length],
    ["After ratio filter", state.result.ratioPassed.length],
    ["Low-ratio recheck candidates", state.result.lowRatioRows.length],
    ["VEP input count", state.result.vepInputs.length],
    ["Generated at", new Date().toLocaleString()],
  ];
  const html = `<html><head><meta charset="utf-8" /></head><body>
    <h2>CMUHCH VEP Phase 1 Summary</h2>${tableFromArrays(summary)}
    <h2>Filtered Variants</h2>${tableFromObjects(rows)}
    <h2>VEP Input</h2>${tableFromArrays(state.result.vepInputs.map((input) => [input]))}
  </body></html>`;
  downloadText(html, `CMUHCH_VEP_${state.selectedSample || "sample"}_phase1.xls`, "application/vnd.ms-excel");
}

function exportInterpretationWorkbook() {
  if (!state.interpretation?.length) return;
  const rows = state.interpretation.map((row) => {
    const record = row.record || {};
    return {
      Classification: row.classification.label,
      Reason: row.classification.reason,
      VEP_Input: row.vepInput,
      Selected_Transcript: row.selectedTranscript,
      Transcript_Status: row.transcriptStatus,
      Gene: record.Gene || "",
      Symbol: record.SYMBOL || "",
      Consequence: record.Consequence || "",
      HGVSc: record.HGVSc || "",
      HGVSp: record.HGVSp || "",
      SIFT: record.SIFT || "",
      PolyPhen: record.PolyPhen || "",
      Existing_variation: record.Existing_variation || "",
      COSMIC: row.inputEvidence.cosmic.join("; "),
      TCGA: row.inputEvidence.tcga.join("; "),
      CNV_Flag: row.item.cnvFlag.pathogenic
        ? `CNV score ${row.item.cnvFlag.score} > 5`
        : row.item.cnvFlag.hasCnv
          ? "CNV"
          : "",
      Original_Row: JSON.stringify(row.item.row),
    };
  });
  const html = `<html><head><meta charset="utf-8" /></head><body>
    <h2>CMUHCH VEP Phase 3 Interpretation</h2>${tableFromObjects(rows)}
  </body></html>`;
  downloadText(html, `CMUHCH_VEP_${state.selectedSample || "sample"}_interpretation.xls`, "application/vnd.ms-excel");
}

function renderDetectedColumns() {
  const label = (index) => (index == null ? "未偵測" : `${columnLetter(index)}: ${state.headers[index] || ""}`);
  els.detectedColumns.innerHTML = `
    <strong>欄位偵測</strong>
    <span>Sample Adapter：${label(state.columns.sample)}</span>
    <span>Variant Description：${label(state.columns.variantDescription)}</span>
    <span>Transcript：${label(state.columns.transcript)}</span>
    <span>Coding Change：${label(state.columns.codingChange)}</span>
    <span>MAF：${state.columns.maf.map(label).join(" / ")}</span>
    <span>CNV score：${label(state.columns.cnvScore)}</span>
    <span>Ratio：${label(state.columns.ratio)}</span>
    <span>COSMIC：${state.columns.cosmic.length ? state.columns.cosmic.map(label).join(" / ") : "未偵測"}</span>
    <span>TCGA：${state.columns.tcga.length ? state.columns.tcga.map(label).join(" / ") : "未偵測"}</span>`;
}

function resetResults() {
  ["synonymous", "maf", "ratio", "vep"].forEach((key) => updateMetric(key, 0));
  clearTable(els.previewTable);
  els.previewNote.textContent = "請選擇 sample 後執行分析";
  els.vepOutput.value = "";
  els.vepNote.textContent = "Transcript:Coding Change";
  els.exportExcel.disabled = true;
  els.buildInterpretation.disabled = true;
  els.exportInterpretation.disabled = true;
  resetInterpretation();
}

function resetInterpretation() {
  state.interpretation = null;
  ["pathogenic", "vus", "benign", "recheck", "manual", "cnvCandidates"].forEach((key) => updateMetric(key, 0));
  if (els.interpretationTable) clearTable(els.interpretationTable);
  if (els.interpretationTableNote) els.interpretationTableNote.textContent = "尚無資料";
  if (els.manualReviewList) els.manualReviewList.innerHTML = "<p>尚未產生判讀結果。</p>";
  if (els.manualReviewNote) els.manualReviewNote.textContent = "NM_ 優先，XM_ 排除";
  if (els.interpretationNote) {
    els.interpretationNote.textContent = "請先完成階段 1；若階段 2 已有 VEP 結果，會自動合併回填。";
  }
  if (els.reportCandidateTable) clearTable(els.reportCandidateTable);
  if (els.reportCandidateNote) els.reportCandidateNote.textContent = "Pathogenic / recheck candidates";
  if (els.saveAudit) els.saveAudit.disabled = true;
}

function renderObjectTable(table, records, headers) {
  clearTable(table);
  const tr = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    tr.appendChild(th);
  });
  table.tHead.appendChild(tr);
  records.forEach((record) => {
    const row = document.createElement("tr");
    headers.forEach((header) => appendCell(row, record[header] || ""));
    table.tBodies[0].appendChild(row);
  });
}

function clearTable(table) {
  table.tHead.innerHTML = "";
  table.tBodies[0].innerHTML = "";
}

function appendCell(row, value) {
  const td = document.createElement("td");
  td.textContent = value;
  row.appendChild(td);
}

function updateMetric(key, value) {
  if (els.metrics[key]) els.metrics[key].textContent = value;
}

function countSampleRows() {
  return state.rows.filter((row) => clean(row[state.columns.sample]) === state.selectedSample).length;
}

function setProgress(step) {
  els.progressItems.forEach((item, index) => item.classList.toggle("active", index < step));
}

function clean(value) {
  return String(value ?? "").trim();
}

function firstValue(value) {
  return clean(value).split(/[;,]/)[0].split(/\s+/)[0].trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, " ");
}

function parseFrequency(value) {
  const raw = clean(value).replace(/,/g, "");
  if (!raw) return NaN;
  const number = parseFloat(raw.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number)) return NaN;
  return raw.includes("%") ? number : number <= 1 ? number * 100 : number;
}

function columnLetter(index) {
  if (index == null) return "";
  let dividend = index + 1;
  let label = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    label = String.fromCharCode(65 + modulo) + label;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return label;
}

function tableFromObjects(rows) {
  if (!rows.length) return "<p>No data</p>";
  const headers = Object.keys(rows[0]);
  return `<table border="1"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function tableFromArrays(rows) {
  return `<table border="1"><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function apiUrl(path) {
  if (location.protocol === "http:" || location.protocol === "https:") return path;
  return `http://127.0.0.1:8765${path}`;
}

function apiHeaders(extra = {}) {
  return {
    ...extra,
    "X-CMUHCH-VEP-Token": window.CMUHCH_VEP_API_TOKEN || "",
  };
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.join("\u0001");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractNumber(value) {
  const number = parseFloat(clean(value));
  return Number.isFinite(number) ? number : NaN;
}
