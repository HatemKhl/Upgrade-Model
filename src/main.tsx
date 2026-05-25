import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./styles.css";

type View = "dashboard" | "assumptions" | "comparison" | "formulas" | "approvals";
type ScenarioId = "highSplit" | "docsis4" | "ftth";
type Status = "Submitted" | "In Review" | "Approved" | "Rejected" | "Needs Revision";

type Global = {
  homesPassed: number;
  currentPenetration: number;
  currentMonthlyArpu: number;
  currentMonthlyChurn: number;
  discountRate: number;
  taxRate: number;
  inflationRate: number;
  horizonYears: number;
  baselineOpexPerHome: number;
};

type Scenario = {
  id: ScenarioId;
  name: string;
  shortName: string;
  color: string;
  networkCapexPerHome: number;
  lowCaseCapexPerHome?: number;
  highCaseCapexPerHome?: number;
  cpeInstallCapexPerSubscriber: number;
  downstreamGbps: number;
  upstreamGbps: number;
  upstreamNote?: string;
  arpuUplift: number;
  churnReduction: number;
  penetrationUplift: number;
  opexPerHome: number;
  efficiencySavings: number;
  deploymentDuration: number;
  aerialCostPerFoot?: number;
  undergroundCostPerFoot?: number;
  aerialMix?: number;
  undergroundMix?: number;
  splitRatio?: number;
  ospPowerSavings?: number;
};

type CashFlow = {
  year: number;
  subscribers: number;
  incrementalRevenue: number;
  incrementalOpex: number;
  capex: number;
  taxes: number;
  freeCashFlow: number;
  cumulativeCashFlow: number;
};

type Result = {
  scenario: Scenario;
  annual: CashFlow[];
  totalCapex: number;
  npv: number;
  roi: number;
  irr: number | null;
  paybackYear: number | null;
  cumulativeCashFlow: number;
};

type Approval = {
  id: string;
  status: Status;
  submittedAt: string;
  projectName: string;
  market: string;
  sponsor: string;
  department: string;
  requestedFunding: number;
  selectedScenario: ScenarioId;
  summary: string;
  rationale: string;
  risks: string;
  dependencies: string;
  notes: string;
  snapshot: { global: Global; scenario: Scenario; kpis: Omit<Result, "scenario" | "annual">; annual: CashFlow[] };
};

const globalDefaults: Global = {
  homesPassed: 50000,
  currentPenetration: 45,
  currentMonthlyArpu: 68,
  currentMonthlyChurn: 1.25,
  discountRate: 10,
  taxRate: 25,
  inflationRate: 3,
  horizonYears: 10,
  baselineOpexPerHome: 107
};

const scenarioDefaults: Record<ScenarioId, Scenario> = {
  highSplit: { id: "highSplit", name: "DOCSIS 3.1 High-Split", shortName: "High-Split", color: "#2563eb", networkCapexPerHome: 100, cpeInstallCapexPerSubscriber: 125, downstreamGbps: 2, upstreamGbps: 1, upstreamNote: "User-facing upstream; technical capacity is roughly 1.5-1.7 Gbps.", arpuUplift: 5, churnReduction: 5, penetrationUplift: 2, opexPerHome: 107, efficiencySavings: 0, deploymentDuration: 2 },
  docsis4: { id: "docsis4", name: "DOCSIS 4.0 HFC", shortName: "DOCSIS 4.0", color: "#0f766e", networkCapexPerHome: 250, lowCaseCapexPerHome: 180, highCaseCapexPerHome: 400, cpeInstallCapexPerSubscriber: 300, downstreamGbps: 10, upstreamGbps: 6, arpuUplift: 10, churnReduction: 10, penetrationUplift: 4, opexPerHome: 107, efficiencySavings: 4, deploymentDuration: 3 },
  ftth: { id: "ftth", name: "FTTH XGS-PON", shortName: "XGS-PON", color: "#b45309", networkCapexPerHome: 1000, lowCaseCapexPerHome: 500, highCaseCapexPerHome: 1500, cpeInstallCapexPerSubscriber: 600, downstreamGbps: 10, upstreamGbps: 10, arpuUplift: 15, churnReduction: 20, penetrationUplift: 7, opexPerHome: 53, efficiencySavings: 0, deploymentDuration: 4, aerialCostPerFoot: 8, undergroundCostPerFoot: 18, aerialMix: 60, undergroundMix: 40, splitRatio: 64, ospPowerSavings: 80 }
};

const views: [View, string][] = [["dashboard", "Dashboard"], ["assumptions", "Assumptions"], ["comparison", "Scenario Comparison"], ["formulas", "Formulas & Methodology"], ["approvals", "Approval Requests"]];
const pct = (v: number) => v / 100;
const usd = (v: number, compact = true) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard" }).format(v);
const num = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
const pc = (v: number) => `${v.toFixed(1)}%`;

function irr(cashFlows: number[]) {
  const npvAt = (rate: number) => cashFlows.reduce((sum, cf, i) => sum + cf / (1 + rate) ** i, 0);
  let low = -0.95;
  let high = 2;
  let lowValue = npvAt(low);
  let highValue = npvAt(high);
  if (Math.sign(lowValue) === Math.sign(highValue)) { high = 10; highValue = npvAt(high); }
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const midValue = npvAt(mid);
    if (Math.abs(midValue) < 0.01) return mid * 100;
    if (Math.sign(midValue) === Math.sign(lowValue)) { low = mid; lowValue = midValue; } else high = mid;
  }
  return ((low + high) / 2) * 100;
}

function calculate(g: Global, s: Scenario): Result {
  const baselineSubscribers = g.homesPassed * pct(g.currentPenetration);
  const baselineRevenue = baselineSubscribers * g.currentMonthlyArpu * 12;
  let cumulativeCashFlow = 0;
  let totalCapex = 0;
  const annual = Array.from({ length: Math.round(g.horizonYears) }, (_, index) => {
    const year = index + 1;
    const ramp = Math.min(1, year / s.deploymentDuration);
    const escalation = (1 + pct(g.inflationRate)) ** (year - 1);
    const incrementalSubscribers = g.homesPassed * pct(s.penetrationUplift) * ramp + baselineSubscribers * pct(g.currentMonthlyChurn) * 12 * pct(s.churnReduction) * ramp;
    const subscribers = baselineSubscribers + incrementalSubscribers;
    const incrementalRevenue = subscribers * (g.currentMonthlyArpu + s.arpuUplift) * 12 - baselineRevenue;
    const scenarioOpex = g.homesPassed * s.opexPerHome * (1 - pct(s.efficiencySavings)) * escalation;
    const baselineOpex = g.homesPassed * g.baselineOpexPerHome * escalation;
    const incrementalOpex = scenarioOpex - baselineOpex;
    const capex = year <= s.deploymentDuration ? ((g.homesPassed * s.networkCapexPerHome) + ((baselineSubscribers + g.homesPassed * pct(s.penetrationUplift)) * s.cpeInstallCapexPerSubscriber)) / s.deploymentDuration * escalation : 0;
    const taxes = Math.max(0, incrementalRevenue - incrementalOpex) * pct(g.taxRate);
    const freeCashFlow = incrementalRevenue - incrementalOpex - capex - taxes;
    cumulativeCashFlow += freeCashFlow;
    totalCapex += capex;
    return { year, subscribers, incrementalRevenue, incrementalOpex, capex, taxes, freeCashFlow, cumulativeCashFlow };
  });
  const npv = annual.reduce((sum, row) => sum + row.freeCashFlow / (1 + pct(g.discountRate)) ** row.year, 0);
  return { scenario: s, annual, totalCapex, npv, roi: totalCapex ? cumulativeCashFlow / totalCapex * 100 : 0, irr: irr([0, ...annual.map((row) => row.freeCashFlow)]), paybackYear: annual.find((row) => row.cumulativeCashFlow >= 0)?.year ?? null, cumulativeCashFlow };
}

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [selected, setSelected] = useState<ScenarioId>("docsis4");
  const [global, setGlobal] = useState(globalDefaults);
  const [scenarios, setScenarios] = useState(scenarioDefaults);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selectedApproval, setSelectedApproval] = useState<string | null>(null);
  const results = useMemo(() => Object.values(scenarios).map((scenario) => calculate(global, scenario)), [global, scenarios]);
  const active = results.find((result) => result.scenario.id === selected) ?? results[0];
  const setG = (key: keyof Global, value: number) => setGlobal((g) => ({ ...g, [key]: value }));
  const setS = (id: ScenarioId, key: keyof Scenario, value: number) => setScenarios((all) => ({ ...all, [id]: { ...all[id], [key]: value } }));

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">BN</div><div><h1>Broadband Upgrade Model</h1><p>Capital planning workspace</p></div></div><nav className="nav-list">{views.map(([id, label]) => <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => setView(id)}>{label}</button>)}</nav><div className="scenario-nav"><p className="eyebrow">Scenarios</p>{results.map((result) => <button key={result.scenario.id} className={selected === result.scenario.id ? "scenario-pill active" : "scenario-pill"} onClick={() => setSelected(result.scenario.id)}><span className="dot" style={{ background: result.scenario.color }} />{result.scenario.shortName}</button>)}</div></aside><main className="workspace"><header className="topbar"><div><p className="eyebrow">Selected Scenario</p><h2>{active.scenario.name}</h2><p className="subtle">{global.horizonYears}-year annual model · {num(global.homesPassed)} homes passed · {pc(global.discountRate)} discount rate</p></div><button className="primary-button" onClick={() => setView("approvals")}>Submit for Approval</button></header>{view === "dashboard" && <Dashboard active={active} results={results} />}{view === "assumptions" && <Assumptions global={global} scenarios={scenarios} setG={setG} setS={setS} />}{view === "comparison" && <Comparison results={results} />}{view === "formulas" && <Formulas />}{view === "approvals" && <Approvals active={active} global={global} approvals={approvals} setApprovals={setApprovals} selectedApproval={selectedApproval} setSelectedApproval={setSelectedApproval} selected={selected} setSelected={setSelected} />}</main></div>;
}

function Kpi({ label, value, tone = "neutral" }: { label: string; value: string; tone?: string }) { return <div className={`kpi-card ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-header"><div><h2>{title}</h2></div></div>{children}</section>; }
function NumberField({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit: string; min: number; max: number; step?: number; onChange: (value: number) => void }) { return <label className="field"><span>{label}</span><div className="input-with-unit"><input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))} /><b>{unit}</b></div><small>Editable model assumption with validation bounds.</small></label>; }

function Dashboard({ active, results }: { active: Result; results: Result[] }) {
  const annual = active.annual.map((row) => ({ year: `Year ${row.year}`, freeCashFlow: row.freeCashFlow, cumulativeCashFlow: row.cumulativeCashFlow, incrementalRevenue: row.incrementalRevenue, capex: row.capex }));
  const comparison = results.map((result) => ({ name: result.scenario.shortName, npv: result.npv, cumulativeCashFlow: result.cumulativeCashFlow }));
  return <section className="view-stack"><div className="kpi-grid"><Kpi label="NPV" value={usd(active.npv)} tone={active.npv >= 0 ? "good" : "bad"} /><Kpi label="ROI" value={pc(active.roi)} tone={active.roi >= 0 ? "good" : "bad"} /><Kpi label="IRR" value={active.irr === null ? "N/A" : pc(active.irr)} /><Kpi label="Payback" value={active.paybackYear ? `Year ${active.paybackYear}` : "No payback"} /><Kpi label="Cumulative Cash Flow" value={usd(active.cumulativeCashFlow)} tone={active.cumulativeCashFlow >= 0 ? "good" : "bad"} /></div><div className="chart-grid two"><Panel title="Scenario KPI Comparison"><Chart data={comparison}><Bar dataKey="npv" name="NPV" fill="#2563eb" /><Bar dataKey="cumulativeCashFlow" name="Cumulative FCF" fill="#64748b" /></Chart></Panel><Panel title="Annual Free Cash Flow"><Chart data={annual}><Bar dataKey="capex" name="Capex" fill="#cbd5e1" /><Line type="monotone" dataKey="incrementalRevenue" name="Incremental Revenue" stroke="#0f766e" strokeWidth={3} /><Line type="monotone" dataKey="freeCashFlow" name="Free Cash Flow" stroke="#2563eb" strokeWidth={3} /></Chart></Panel></div><Panel title="Cumulative Cash Flow"><Chart data={annual}><Line type="monotone" dataKey="cumulativeCashFlow" name="Cumulative Cash Flow" stroke="#2563eb" strokeWidth={3} /></Chart></Panel></section>;
}

function Chart({ data, children }: { data: object[]; children: React.ReactNode }) { return <ResponsiveContainer width="100%" height={310}><BarChart data={data}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={false} /><YAxis tickFormatter={(value) => usd(Number(value))} /><Tooltip formatter={(value) => usd(Number(value))} /><Legend />{children}</BarChart></ResponsiveContainer>; }

function Assumptions({ global, scenarios, setG, setS }: { global: Global; scenarios: Record<ScenarioId, Scenario>; setG: (key: keyof Global, value: number) => void; setS: (id: ScenarioId, key: keyof Scenario, value: number) => void }) {
  return <section className="view-stack"><Panel title="Global Assumptions"><div className="input-grid"><NumberField label="Homes passed" value={global.homesPassed} unit="homes" min={1000} max={5000000} onChange={(v) => setG("homesPassed", v)} /><NumberField label="Current penetration" value={global.currentPenetration} unit="%" min={0} max={100} onChange={(v) => setG("currentPenetration", v)} /><NumberField label="Current ARPU" value={global.currentMonthlyArpu} unit="$ / mo" min={0} max={300} onChange={(v) => setG("currentMonthlyArpu", v)} /><NumberField label="Monthly churn" value={global.currentMonthlyChurn} unit="%" min={0} max={10} step={0.05} onChange={(v) => setG("currentMonthlyChurn", v)} /><NumberField label="Discount rate" value={global.discountRate} unit="%" min={0} max={40} step={0.25} onChange={(v) => setG("discountRate", v)} /><NumberField label="Tax rate" value={global.taxRate} unit="%" min={0} max={60} step={0.25} onChange={(v) => setG("taxRate", v)} /><NumberField label="Inflation / escalation" value={global.inflationRate} unit="%" min={0} max={20} step={0.25} onChange={(v) => setG("inflationRate", v)} /><NumberField label="Analysis horizon" value={global.horizonYears} unit="years" min={1} max={30} onChange={(v) => setG("horizonYears", v)} /><NumberField label="Baseline HFC opex" value={global.baselineOpexPerHome} unit="$ / HP / yr" min={0} max={500} onChange={(v) => setG("baselineOpexPerHome", v)} /></div></Panel>{Object.values(scenarios).map((scenario) => <Panel key={scenario.id} title={scenario.name}><div className="scenario-capability"><span>Downstream: {scenario.downstreamGbps} Gbps</span><span>Upstream: {scenario.upstreamGbps} Gbps</span>{scenario.upstreamNote && <span>{scenario.upstreamNote}</span>}</div><div className="input-grid"><NumberField label="Network capex per home" value={scenario.networkCapexPerHome} unit="$ / HP" min={0} max={3000} onChange={(v) => setS(scenario.id, "networkCapexPerHome", v)} /><NumberField label="CPE / install capex" value={scenario.cpeInstallCapexPerSubscriber} unit="$ / sub" min={0} max={3000} onChange={(v) => setS(scenario.id, "cpeInstallCapexPerSubscriber", v)} /><NumberField label="ARPU uplift" value={scenario.arpuUplift} unit="$ / mo" min={0} max={100} onChange={(v) => setS(scenario.id, "arpuUplift", v)} /><NumberField label="Churn reduction" value={scenario.churnReduction} unit="%" min={0} max={100} onChange={(v) => setS(scenario.id, "churnReduction", v)} /><NumberField label="Penetration uplift" value={scenario.penetrationUplift} unit="pts" min={0} max={40} step={0.25} onChange={(v) => setS(scenario.id, "penetrationUplift", v)} /><NumberField label="Opex per home" value={scenario.opexPerHome} unit="$ / HP / yr" min={0} max={500} onChange={(v) => setS(scenario.id, "opexPerHome", v)} /><NumberField label="Efficiency savings" value={scenario.efficiencySavings} unit="%" min={0} max={100} onChange={(v) => setS(scenario.id, "efficiencySavings", v)} /><NumberField label="Deployment duration" value={scenario.deploymentDuration} unit="years" min={1} max={10} onChange={(v) => setS(scenario.id, "deploymentDuration", v)} /></div></Panel>)}</section>;
}

function Comparison({ results }: { results: Result[] }) { return <section className="view-stack"><Panel title="Side-by-Side Comparison"><div className="table-wrap"><table><thead><tr><th>Scenario</th><th>Capex</th><th>ARPU Uplift</th><th>Churn Reduction</th><th>NPV</th><th>ROI</th><th>IRR</th><th>Payback</th></tr></thead><tbody>{results.map((r) => <tr key={r.scenario.id}><td><strong>{r.scenario.name}</strong></td><td>{usd(r.totalCapex)}</td><td>{usd(r.scenario.arpuUplift, false)} / mo</td><td>{pc(r.scenario.churnReduction)}</td><td>{usd(r.npv)}</td><td>{pc(r.roi)}</td><td>{r.irr === null ? "N/A" : pc(r.irr)}</td><td>{r.paybackYear ? `Year ${r.paybackYear}` : "No payback"}</td></tr>)}</tbody></table></div></Panel><Panel title="Capability and Financial Positioning"><Chart data={results.map((r) => ({ name: r.scenario.shortName, npv: r.npv, cumulativeCashFlow: r.cumulativeCashFlow }))}><Bar dataKey="npv" name="NPV" fill="#2563eb" /><Bar dataKey="cumulativeCashFlow" name="Cumulative FCF" fill="#b45309" /></Chart></Panel></section>; }

function Formulas() { const formulas = [["Subscribers", "Homes passed x penetration, plus ramped penetration uplift and lower-churn retention."], ["Revenue", "Subscribers x monthly ARPU x 12."], ["Incremental revenue", "Scenario revenue minus baseline revenue."], ["Capex", "Network capex per home passed plus success-based CPE/install capex."], ["Opex", "Homes passed x annual opex per home, adjusted by efficiency savings and escalation."], ["Free cash flow", "Incremental revenue - incremental opex - capex - taxes."], ["NPV", "Annual free cash flows discounted at the selected discount rate."], ["ROI", "Cumulative net cash flow divided by total capex."], ["IRR", "Discount rate where NPV equals zero."], ["Payback", "First year when cumulative free cash flow turns positive."]]; return <section className="view-stack"><Panel title="Formulas & Methodology"><div className="method-grid">{formulas.map(([title, body]) => <div className="method-card" key={title}><h3>{title}</h3><p>{body}</p></div>)}</div></Panel><Panel title="Modeling Notes"><div className="plain-text"><p>The model compares each upgrade against the existing DOCSIS 3.1 low-split plant. Value comes from ARPU uplift, retained subscribers, additional penetration, opex savings, and avoided churn.</p><p>Network and success-based capex are spread over the deployment period. Taxes are applied only to positive incremental operating income.</p></div></Panel></section>; }

function Approvals({ active, global, approvals, setApprovals, selectedApproval, setSelectedApproval, selected, setSelected }: { active: Result; global: Global; approvals: Approval[]; setApprovals: React.Dispatch<React.SetStateAction<Approval[]>>; selectedApproval: string | null; setSelectedApproval: (id: string | null) => void; selected: ScenarioId; setSelected: (id: ScenarioId) => void }) {
  const [form, setForm] = useState({ projectName: "Metro Edge Broadband Upgrade", market: "Primary service footprint", sponsor: "Network Strategy", department: "Capital Planning", requestedFunding: Math.round(active.totalCapex), summary: "Upgrade the broadband access network to improve capacity, competitiveness, and long-term free cash flow.", rationale: "Protect share, increase ARPU, reduce churn, and position the market for multi-gigabit services.", risks: "Execution timing, construction inflation, equipment availability, and competitive response.", dependencies: "Node plan, vendor procurement, field operations schedule, and customer migration communications.", notes: "" });
  const selectedSnapshot = approvals.find((request) => request.id === selectedApproval) ?? approvals[0];
  const submit = (event: React.FormEvent) => { event.preventDefault(); const request: Approval = { id: crypto.randomUUID(), status: "Submitted", submittedAt: new Date().toISOString(), selectedScenario: selected, ...form, snapshot: { global: structuredClone(global), scenario: structuredClone(active.scenario), kpis: { totalCapex: active.totalCapex, npv: active.npv, roi: active.roi, irr: active.irr, paybackYear: active.paybackYear, cumulativeCashFlow: active.cumulativeCashFlow }, annual: structuredClone(active.annual) } }; setApprovals((all) => [request, ...all]); setSelectedApproval(request.id); };
  const status = (id: string, next: Status) => setApprovals((all) => all.map((request) => request.id === id ? { ...request, status: next } : request));
  return <section className="view-stack"><Panel title="Submit for Approval"><form className="approval-form" onSubmit={submit}><div className="input-grid"><label className="field"><span>Project name</span><input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} /></label><label className="field"><span>Market / footprint</span><input value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} /></label><label className="field"><span>Sponsor</span><input value={form.sponsor} onChange={(e) => setForm({ ...form, sponsor: e.target.value })} /></label><label className="field"><span>Department</span><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label><label className="field"><span>Requested funding</span><input type="number" value={form.requestedFunding} onChange={(e) => setForm({ ...form, requestedFunding: Number(e.target.value) })} /></label><label className="field"><span>Selected scenario</span><select value={selected} onChange={(e) => setSelected(e.target.value as ScenarioId)}><option value="highSplit">DOCSIS 3.1 High-Split</option><option value="docsis4">DOCSIS 4.0 HFC</option><option value="ftth">FTTH XGS-PON</option></select><small>Snapshot freezes assumptions, KPIs, annual cash flows, and chart data.</small></label></div><div className="textarea-grid">{(["summary", "rationale", "risks", "dependencies", "notes"] as const).map((key) => <label className="field" key={key}><span>{key}</span><textarea value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}</div><button className="primary-button submit">Create Submitted Snapshot</button></form></Panel><div className="approval-layout"><Panel title="Submitted Requests"><div className="request-list">{approvals.length === 0 && <p className="empty">No approval requests submitted yet.</p>}{approvals.map((request) => <button key={request.id} className={selectedSnapshot?.id === request.id ? "request-row active" : "request-row"} onClick={() => setSelectedApproval(request.id)}><span><strong>{request.projectName}</strong><small>{new Date(request.submittedAt).toLocaleString()} · {request.snapshot.scenario.name}</small></span><StatusBadge status={request.status} /></button>)}</div></Panel><Panel title="Frozen Snapshot">{selectedSnapshot ? <div className="snapshot"><div className="snapshot-header"><div><h3>{selectedSnapshot.projectName}</h3><p>{selectedSnapshot.market} · {selectedSnapshot.sponsor} · {selectedSnapshot.department}</p></div><StatusBadge status={selectedSnapshot.status} /></div><div className="mini-kpis"><Kpi label="Requested Funding" value={usd(selectedSnapshot.requestedFunding)} /><Kpi label="NPV" value={usd(selectedSnapshot.snapshot.kpis.npv)} /><Kpi label="ROI" value={pc(selectedSnapshot.snapshot.kpis.roi)} /><Kpi label="Payback" value={selectedSnapshot.snapshot.kpis.paybackYear ? `Year ${selectedSnapshot.snapshot.kpis.paybackYear}` : "No payback"} /></div><div className="action-row">{(["In Review", "Approved", "Rejected", "Needs Revision"] as Status[]).map((next) => <button key={next} type="button" onClick={() => status(selectedSnapshot.id, next)}>{next}</button>)}</div><div className="table-wrap compact"><table><thead><tr><th>Year</th><th>Revenue</th><th>Capex</th><th>FCF</th><th>Cumulative</th></tr></thead><tbody>{selectedSnapshot.snapshot.annual.map((row) => <tr key={row.year}><td>{row.year}</td><td>{usd(row.incrementalRevenue)}</td><td>{usd(row.capex)}</td><td>{usd(row.freeCashFlow)}</td><td>{usd(row.cumulativeCashFlow)}</td></tr>)}</tbody></table></div></div> : <p className="empty">Select or submit a request to view the frozen model snapshot.</p>}</Panel></div></section>;
}

function StatusBadge({ status }: { status: Status }) { return <span className={`status ${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>; }

createRoot(document.getElementById("root")!).render(<App />);
