/* ============================================================
   SATERA TUNING — Premium UI Stylesheet
   ============================================================ */

@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');

/* ── CSS Variables ── */
:root {
  --green:      #3dff7a;
  --green-dim:  #1a7a38;
  --green-lo:   rgba(61,255,122,0.07);
  --green-glow: rgba(61,255,122,0.18);
  --amber:      #f5a623;
  --red:        #ff5252;
  --blue:       #4db8ff;
  --bg:         #090c09;
  --card:       #111811;
  --card-hi:    #141e14;
  --border:     #1a281a;
  --border-hi:  #274027;
  --text:       #dff0df;
  --muted:      #5a8f5a;
}

/* ── Base ── */
*, *::before, *::after { box-sizing: border-box; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', system-ui, sans-serif;
  margin: 0;
  /* Subtle noise texture */
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
}

/* ── Keyframes ── */
@keyframes shimmer {
  0%  { background-position: 200% 0; }
  100%{ background-position: -200% 0; }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulseGreen {
  0%, 100% { box-shadow: 0 0 0 0 rgba(61,255,122,0); }
  50%       { box-shadow: 0 0 0 6px rgba(61,255,122,0.08); }
}

@keyframes scanline {
  0%   { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
}

@keyframes borderGlow {
  0%, 100% { border-color: #1a281a; }
  50%       { border-color: #274027; }
}

@keyframes countUp {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes slideInLeft {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes glowPulse {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 0.8; }
}

/* ── Page-level animated background ── */
.st-page {
  position: relative;
  min-height: 100vh;
  overflow-x: hidden;
}

.st-page::before {
  content: '';
  position: fixed;
  top: -50%;
  left: -20%;
  width: 60%;
  height: 80%;
  background: radial-gradient(ellipse, rgba(61,255,122,0.04) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
  animation: glowPulse 8s ease-in-out infinite;
}

.st-page::after {
  content: '';
  position: fixed;
  bottom: -30%;
  right: -20%;
  width: 50%;
  height: 70%;
  background: radial-gradient(ellipse, rgba(61,255,122,0.03) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
  animation: glowPulse 10s ease-in-out infinite reverse;
}

/* ── Header ── */
.st-header {
  position: relative;
  z-index: 100;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 32px;
  height: 68px;
  background: rgba(9,12,9,0.95);
  border-bottom: 1px solid var(--border-hi);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.st-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--green-glow), transparent);
}

/* ── Logo ── */
.st-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: 'Rajdhani', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--green);
  text-shadow: 0 0 20px rgba(61,255,122,0.3);
}

.st-logo-icon {
  width: 34px;
  height: 34px;
  border: 1.5px solid var(--green);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 12px rgba(61,255,122,0.2), inset 0 0 8px rgba(61,255,122,0.05);
  animation: pulseGreen 4s ease-in-out infinite;
}

.st-logo-sub {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  letter-spacing: 0.5px;
  text-transform: none;
  margin-left: -4px;
}

.st-beta {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--green-dim);
  background: var(--green-lo);
  border: 1px solid rgba(61,255,122,0.15);
  border-radius: 4px;
  padding: 2px 7px;
}

/* ── Nav buttons ── */
.st-btn-nav {
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--green);
  background: var(--green-lo);
  border: 1px solid var(--border-hi);
  border-radius: 6px;
  padding: 8px 18px;
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
}

.st-btn-nav::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(61,255,122,0.05), transparent);
  opacity: 0;
  transition: opacity 0.2s;
}

.st-btn-nav:hover { border-color: var(--green); background: rgba(61,255,122,0.12); }
.st-btn-nav:hover::before { opacity: 1; }

/* ── Primary button ── */
.st-btn-primary {
  font-family: 'Rajdhani', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #000;
  background: var(--green);
  border: none;
  border-radius: 6px;
  padding: 10px 22px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
  box-shadow: 0 0 20px rgba(61,255,122,0.2);
}

.st-btn-primary::after {
  content: '';
  position: absolute;
  top: 0; left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transition: left 0.4s;
}

.st-btn-primary:hover { box-shadow: 0 0 30px rgba(61,255,122,0.4); transform: translateY(-1px); }
.st-btn-primary:hover::after { left: 150%; }
.st-btn-primary:active { transform: translateY(0); }
.st-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }

/* ── Ghost button ── */
.st-btn-ghost {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.st-btn-ghost:hover { border-color: var(--border-hi); color: var(--text); }

/* ── Cards ── */
.st-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.3s;
}

.st-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(61,255,122,0.1), transparent);
}

.st-card-highlight {
  background: var(--card-hi);
  border: 1px solid var(--border-hi);
  border-radius: 12px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(61,255,122,0.04) inset, 0 4px 24px rgba(0,0,0,0.3);
}

.st-card-highlight::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(61,255,122,0.2), transparent);
}

.st-card-critical {
  background: rgba(255,82,82,0.05);
  border: 1px solid rgba(255,82,82,0.2);
  border-radius: 12px;
  padding: 16px;
  position: relative;
  animation: fadeInUp 0.3s ease both;
}

.st-card-critical::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,82,82,0.3), transparent);
}

/* ── Section titles ── */
.st-section-title {
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--green);
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.st-section-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border-hi), transparent);
}

/* ── How it works banner ── */
.st-how-it-works {
  background: linear-gradient(135deg, rgba(61,255,122,0.04) 0%, rgba(61,255,122,0.01) 100%);
  border: 1px solid var(--border-hi);
  border-radius: 12px;
  padding: 18px 24px;
  margin-bottom: 20px;
  position: relative;
  overflow: hidden;
  animation: fadeInUp 0.4s ease both;
}

.st-how-it-works::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--green), transparent);
  opacity: 0.4;
}

.st-how-it-works-steps {
  display: flex;
  gap: 0;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 12px;
}

.st-step {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 160px;
}

.st-step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--green-lo);
  border: 1px solid rgba(61,255,122,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: var(--green);
  flex-shrink: 0;
}

.st-step-arrow {
  color: var(--border-hi);
  font-size: 18px;
  margin: 0 8px;
  flex-shrink: 0;
}

.st-step-text {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}

.st-step-text strong {
  color: var(--text);
  display: block;
  font-size: 13px;
  margin-bottom: 1px;
}

/* ── Upload zone ── */
.upload-label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  border-radius: 8px;
  border: 1.5px dashed var(--border-hi);
  cursor: pointer;
  color: var(--muted);
  font-size: 13px;
  transition: all 0.25s;
  background: rgba(61,255,122,0.02);
  width: 100%;
}

.upload-label:hover {
  border-color: var(--green);
  color: var(--green);
  background: rgba(61,255,122,0.05);
  box-shadow: 0 0 16px rgba(61,255,122,0.08);
}

.upload-label.has-file {
  border-color: var(--border-hi);
  border-style: solid;
  color: var(--text);
  background: rgba(61,255,122,0.04);
}

input[type=file] { display: none; }

/* ── Inputs / selects ── */
.st-input, .st-select {
  width: 100%;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 9px 12px;
  color: var(--text);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-sizing: border-box;
}

.st-input:focus, .st-select:focus {
  border-color: rgba(61,255,122,0.3);
  box-shadow: 0 0 0 3px rgba(61,255,122,0.06);
}

.st-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%233dff7a'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: calc(100% - 12px) 50%;
  padding-right: 32px;
  cursor: pointer;
}

select option { background: #111811; }

/* ── Metric tiles ── */
.st-metric {
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  transition: border-color 0.2s, transform 0.2s;
  animation: countUp 0.4s ease both;
}

.st-metric:hover { border-color: var(--border-hi); transform: translateY(-1px); }

.st-metric-timer {
  background: rgba(61,255,122,0.05);
  border-color: rgba(61,255,122,0.2);
  box-shadow: 0 0 12px rgba(61,255,122,0.05);
}

.st-metric-timer:hover {
  border-color: rgba(61,255,122,0.35);
  box-shadow: 0 0 20px rgba(61,255,122,0.1);
}

.st-metric-label {
  font-family: 'Rajdhani', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 5px;
}

.st-metric-value {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  color: #4db8ff;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.st-metric-timer .st-metric-label { color: var(--green); }
.st-metric-timer .st-metric-value { color: var(--green); font-size: 24px; }

/* ── Check rows ── */
.st-check-row {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 5px;
  border-left: 3px solid;
  animation: slideInLeft 0.3s ease both;
  transition: background 0.2s;
}

.st-check-row:hover { filter: brightness(1.1); }

/* ── AI summary cards ── */
.st-ai-card {
  border-radius: 12px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  animation: fadeInUp 0.5s ease both;
}

.st-ai-card-summary {
  background: linear-gradient(135deg, rgba(61,255,122,0.05) 0%, rgba(61,255,122,0.02) 100%);
  border: 1px solid rgba(61,255,122,0.2);
}

.st-ai-card-action {
  background: linear-gradient(135deg, rgba(77,184,255,0.05) 0%, rgba(77,184,255,0.02) 100%);
  border: 1px solid rgba(77,184,255,0.2);
}

.st-ai-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
}

.st-ai-card-summary::before { background: linear-gradient(90deg, transparent, rgba(61,255,122,0.4), transparent); }
.st-ai-card-action::before  { background: linear-gradient(90deg, transparent, rgba(77,184,255,0.4), transparent); }

/* ── Step badge ── */
.st-step-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.st-step-badge-num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.3s;
}

/* ── Skeleton shimmer ── */
.st-skeleton {
  border-radius: 4px;
  background: linear-gradient(90deg, #151e15 25%, #1e2d1e 50%, #151e15 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

/* ── Leaderboard ── */
.lb-row td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  transition: background 0.15s;
}

.lb-row:hover td { background: rgba(61,255,122,0.03); }
.lb-row-top td { color: #eaff9c; }
.lb-row-top { background: rgba(61,255,122,0.025); }

/* ── Interval pills ── */
.st-interval-btn {
  font-family: 'Rajdhani', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.2s;
}

.st-interval-btn:hover { border-color: var(--border-hi); color: var(--text); }

.st-interval-btn.active {
  background: var(--green-lo);
  border-color: var(--green);
  color: var(--green);
  box-shadow: 0 0 12px rgba(61,255,122,0.1);
}

/* ── Status bar ── */
.st-status {
  font-size: 12px;
  padding: 3px 0;
}

/* ── Animations: staggered children ── */
.st-animate-children > * {
  animation: fadeInUp 0.4s ease both;
}

.st-animate-children > *:nth-child(1) { animation-delay: 0.05s; }
.st-animate-children > *:nth-child(2) { animation-delay: 0.10s; }
.st-animate-children > *:nth-child(3) { animation-delay: 0.15s; }
.st-animate-children > *:nth-child(4) { animation-delay: 0.20s; }
.st-animate-children > *:nth-child(5) { animation-delay: 0.25s; }
.st-animate-children > *:nth-child(6) { animation-delay: 0.30s; }

/* ── Dyno chart container ── */
.st-dyno-chart {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0,0,0,0.2);
  border: 1px solid var(--border);
  padding: 12px;
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--green-dim); }

/* ── Responsive ── */
@media (max-width: 1100px) {
  .st-header { padding: 0 16px; }
}
