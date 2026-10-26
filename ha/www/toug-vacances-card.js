/*
 * Carte Lovelace "Mode vacances" pour la TOUG (T.One AIR / AquaAIR).
 *
 * Installation :
 *   1. Copier ce fichier dans /config/www/toug-vacances-card.js
 *   2. Paramètres > Tableaux de bord > ⋮ > Ressources > Ajouter :
 *        URL : /local/toug-vacances-card.js?v=1   Type : Module JavaScript
 *   3. Ajouter la carte :
 *        type: custom:toug-vacances-card
 *
 * Options (toutes facultatives) :
 *   title, switch, debut, fin, sensor_debut, sensor_fin, heure_fin ("18:00")
 */

const VERSION = "1.1.0";
const ITEM_H = 36; // hauteur d'une ligne de molette (px)
const VISIBLE = 5; // nombre de lignes visibles (impair)
const PAD = (VISIBLE - 1) / 2;

const pad2 = (n) => String(n).padStart(2, "0");

const toDateStr = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/* ------------------------------------------------------------------ */
/* Molette rotative éditable (0..max)                                  */
/* ------------------------------------------------------------------ */
class Wheel {
  constructor(max, value, label, onChange) {
    this.max = max;
    this._value = value;
    this.onChange = onChange;
    this._timer = null;

    this.el = document.createElement("div");
    this.el.className = "wheel";
    this.el.innerHTML = `
      <div class="wheel-band"></div>
      <div class="wheel-scroll" tabindex="0" role="spinbutton"
           aria-label="${label}" aria-valuemin="0" aria-valuemax="${max}"></div>
      <input class="wheel-input" type="text" inputmode="numeric"
             maxlength="2" aria-label="${label}" hidden>`;
    this.scroll = this.el.querySelector(".wheel-scroll");
    this.input = this.el.querySelector(".wheel-input");

    const frag = document.createDocumentFragment();
    const spacer = () => {
      const s = document.createElement("div");
      s.style.height = `${PAD * ITEM_H}px`;
      return s;
    };
    frag.appendChild(spacer());
    this.items = [];
    for (let i = 0; i <= max; i++) {
      const it = document.createElement("div");
      it.className = "wheel-item";
      it.textContent = pad2(i);
      it.addEventListener("click", () => {
        if (i === this._value) this._openEditor();
        else this.set(i, true);
      });
      this.items.push(it);
      frag.appendChild(it);
    }
    frag.appendChild(spacer());
    this.scroll.appendChild(frag);

    this.scroll.addEventListener("scroll", () => this._onScroll(), {
      passive: true,
    });
    this.scroll.addEventListener("keydown", (e) => this._onKey(e));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this._closeEditor(true);
      else if (e.key === "Escape") this._closeEditor(false);
    });
    this.input.addEventListener("blur", () => this._closeEditor(true));

    // Positionne la molette dès qu'elle est réellement affichée
    new ResizeObserver(() => {
      if (this.scroll.clientHeight > 0) this._scrollTo(this._value, false);
    }).observe(this.scroll);
    this._highlight(value);
  }

  get value() {
    return this._value;
  }

  set(v, smooth = false, notify = true) {
    v = Math.min(this.max, Math.max(0, v | 0));
    const changed = v !== this._value;
    this._value = v;
    this._highlight(v);
    this._scrollTo(v, smooth);
    if (changed && notify) this.onChange(v);
  }

  _scrollTo(v, smooth) {
    this.scroll.scrollTo({ top: v * ITEM_H, behavior: smooth ? "smooth" : "auto" });
  }

  _highlight(v) {
    if (this._hl !== undefined && this.items[this._hl])
      this.items[this._hl].classList.remove("sel");
    this.items[v].classList.add("sel");
    this._hl = v;
    this.scroll.setAttribute("aria-valuenow", v);
  }

  _onScroll() {
    const idx = Math.min(this.max, Math.max(0, Math.round(this.scroll.scrollTop / ITEM_H)));
    if (idx !== this._hl) this._highlight(idx);
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (idx !== this._value) {
        this._value = idx;
        this.onChange(idx);
      }
    }, 120);
  }

  _onKey(e) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.set(this._value - 1, true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.set(this._value + 1, true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this._openEditor();
    } else if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      this._openEditor(e.key);
    }
  }

  _openEditor(initial) {
    this.input.hidden = false;
    this.input.value = initial ?? pad2(this._value);
    this.input.focus();
    if (initial === undefined) this.input.select();
  }

  _closeEditor(commit) {
    if (this.input.hidden) return;
    const n = parseInt(this.input.value, 10);
    this.input.hidden = true;
    if (commit && !Number.isNaN(n)) this.set(n, true);
    this.scroll.focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ */
/* Carte                                                               */
/* ------------------------------------------------------------------ */
class TougVacancesCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = {
      title: "Mode vacances",
      switch: "switch.toug_aquaair_vacances",
      debut: "datetime.toug_aquaair_vacances_debut",
      fin: "datetime.toug_aquaair_vacances_fin",
      sensor_debut: "sensor.toug_aquaair_debut_vacances",
      sensor_fin: "sensor.toug_aquaair_fin_vacances",
      heure_fin: "18:00",
      ...config,
    };
    this._editing = false;
    this._pending = null;
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._root) this._updateStatus();
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  /* ---------- construction ---------- */

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="head">
          <ha-icon icon="mdi:beach"></ha-icon>
          <div class="title"></div>
          <div class="chip"></div>
        </div>
        <div class="status" hidden>
          <div class="status-text"></div>
          <div class="actions">
            <button class="btn ghost" data-act="edit">Modifier</button>
            <button class="btn danger" data-act="off">Arrêter</button>
          </div>
        </div>
        <div class="form">
          <div class="slot" data-slot="debut"></div>
          <div class="slot" data-slot="fin"></div>
          <div class="summary"></div>
          <button class="btn primary" data-act="on">Activer le mode vacances</button>
        </div>
      </ha-card>`;
    this._root = root;
    root.querySelector(".title").textContent = this._config.title;

    // Valeurs par défaut : début = maintenant, fin = demain à heure_fin
    const now = new Date();
    const demain = new Date(now.getTime() + 86400000);
    const [fh, fm] = String(this._config.heure_fin).split(":").map((x) => parseInt(x, 10) || 0);
    this._slots = {
      debut: this._buildSlot("debut", toDateStr(now), now.getHours(), now.getMinutes()),
      fin: this._buildSlot("fin", toDateStr(demain), fh, fm),
    };

    root.querySelector('[data-act="on"]').addEventListener("click", () => this._activate());
    root.querySelector('[data-act="off"]').addEventListener("click", () => this._deactivate());
    root.querySelector('[data-act="edit"]').addEventListener("click", () => {
      this._editing = !this._editing;
      this._updateStatus();
    });

    this._validate();
    if (this._hass) this._updateStatus();
  }

  _buildSlot(name, date, h, m) {
    const slot = this._root.querySelector(`[data-slot="${name}"]`);
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("div");
    label.className = "slot-label";
    label.textContent = name === "debut" ? "Début" : "Fin";

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "date";
    dateInput.value = date;
    dateInput.required = true;
    dateInput.addEventListener("change", () => this._validate());

    // Heure affichée en bouton ; les molettes s'ouvrent au clic
    const timeBtn = document.createElement("button");
    timeBtn.className = "time-btn";
    timeBtn.setAttribute("aria-expanded", "false");

    const picker = document.createElement("div");
    picker.className = "picker";
    picker.hidden = true;
    const time = document.createElement("div");
    time.className = "time";
    const s = {};
    const onChange = () => {
      timeBtn.textContent = `${pad2(s.wh.value)}:${pad2(s.wm.value)}`;
      this._validate();
    };
    s.wh = new Wheel(23, h, `Heure ${name}`, onChange);
    s.wm = new Wheel(59, m, `Minutes ${name}`, onChange);
    const sep = document.createElement("div");
    sep.className = "sep";
    sep.textContent = ":";
    time.append(s.wh.el, sep, s.wm.el);
    const ok = document.createElement("button");
    ok.className = "btn ghost ok";
    ok.textContent = "OK";
    ok.addEventListener("click", () => this._togglePicker(name, false));
    picker.append(time, ok);

    timeBtn.textContent = `${pad2(h)}:${pad2(m)}`;
    timeBtn.addEventListener("click", () => this._togglePicker(name));

    row.append(label, dateInput, timeBtn);
    slot.append(row, picker);
    return { dateInput, wh: s.wh, wm: s.wm, timeBtn, picker };
  }

  _togglePicker(name, force) {
    for (const [n, s] of Object.entries(this._slots)) {
      const open = n === name ? (force ?? s.picker.hidden) : false;
      s.picker.hidden = !open;
      s.timeBtn.classList.toggle("open", open);
      s.timeBtn.setAttribute("aria-expanded", String(open));
    }
  }

  /* ---------- logique ---------- */

  _dateOf(slot) {
    const { dateInput, wh, wm } = this._slots[slot];
    if (!dateInput.value) return null;
    const d = new Date(`${dateInput.value}T${pad2(wh.value)}:${pad2(wm.value)}:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  _validate() {
    const summary = this._root.querySelector(".summary");
    const btn = this._root.querySelector('[data-act="on"]');
    const now = new Date();
    let deb = this._dateOf("debut");
    const fin = this._dateOf("fin");
    let msg = "";
    let ok = true;

    if (!deb || !fin) {
      ok = false;
      msg = "Renseigner les dates de début et de fin.";
    } else {
      const immediat = deb <= now;
      if (immediat) deb = now;
      if (fin <= now) {
        ok = false;
        msg = "La fin doit être dans le futur.";
      } else if (fin <= deb) {
        ok = false;
        msg = "La fin doit être après le début.";
      } else {
        const min = Math.round((fin - deb) / 60000);
        const j = Math.floor(min / 1440);
        const h = Math.floor((min % 1440) / 60);
        const mn = min % 60;
        const parts = [];
        if (j) parts.push(`${j} j`);
        if (h) parts.push(`${h} h`);
        if (!j && mn) parts.push(`${mn} min`);
        msg = `Durée : ${parts.join(" ") || "< 1 min"}${immediat ? " · début immédiat" : ""}`;
      }
    }
    summary.textContent = msg;
    summary.classList.toggle("error", !ok);
    btn.disabled = !ok || !!this._pending;
    return ok;
  }

  async _activate() {
    if (!this._validate() || !this._hass) return;
    const c = this._config;
    const s = this._slots;
    const debut = `${s.debut.dateInput.value} ${pad2(s.debut.wh.value)}:${pad2(s.debut.wm.value)}:00`;
    // L'ESP remplace une fin à 00:00:00 par 18h00 : on envoie 00:00:01 pour garder minuit
    const finSec = s.fin.wh.value === 0 && s.fin.wm.value === 0 ? "01" : "00";
    const fin = `${s.fin.dateInput.value} ${pad2(s.fin.wh.value)}:${pad2(s.fin.wm.value)}:${finSec}`;

    this._togglePicker(null, false);
    this._setPending("Envoi à la TOUG…");
    try {
      await this._hass.callService("datetime", "set_value", { datetime: debut }, { entity_id: c.debut });
      await this._hass.callService("datetime", "set_value", { datetime: fin }, { entity_id: c.fin });
      await this._hass.callService("switch", "turn_on", {}, { entity_id: c.switch });
      this._editing = false;
      this._setPending("En attente de confirmation de la PAC…", 90000);
    } catch (err) {
      this._setPending(null);
      this._showError(err);
    }
  }

  async _deactivate() {
    if (!this._hass) return;
    this._setPending("Arrêt en cours…");
    try {
      await this._hass.callService("switch", "turn_off", {}, { entity_id: this._config.switch });
      this._setPending("En attente de confirmation de la PAC…", 90000);
    } catch (err) {
      this._setPending(null);
      this._showError(err);
    }
  }

  _setPending(text, timeout = 0) {
    clearTimeout(this._pendingTimer);
    this._pending = text ? { text, wasOn: this._isOn() } : null;
    if (text && timeout)
      this._pendingTimer = setTimeout(() => {
        this._pending = null;
        this._updateStatus();
        this._validate();
      }, timeout);
    this._updateStatus();
    this._validate();
  }

  _showError(err) {
    const summary = this._root.querySelector(".summary");
    summary.textContent = `Erreur : ${err?.message || err}`;
    summary.classList.add("error");
  }

  _isOn() {
    return this._hass?.states[this._config.switch]?.state === "on";
  }

  _fmt(entityId) {
    const st = this._hass?.states[entityId]?.state;
    if (!st || st === "unknown" || st === "unavailable") return "?";
    const d = new Date(st);
    if (Number.isNaN(d.getTime())) return st;
    return d.toLocaleString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  _updateStatus() {
    const r = this._root;
    const c = this._config;
    const swState = this._hass?.states[c.switch];
    const on = this._isOn();

    // Fin de l'attente dès que l'état de l'interrupteur a changé
    if (this._pending && this._pending.wasOn !== on && /confirmation/.test(this._pending.text)) {
      clearTimeout(this._pendingTimer);
      this._pending = null;
    }

    const chip = r.querySelector(".chip");
    if (!swState) {
      chip.textContent = "Entité introuvable";
      chip.className = "chip warn";
    } else if (this._pending) {
      chip.textContent = this._pending.text;
      chip.className = "chip busy";
    } else {
      chip.textContent = on ? "Actif" : "Inactif";
      chip.className = `chip ${on ? "on" : ""}`;
    }

    const status = r.querySelector(".status");
    status.hidden = !on;
    if (on) {
      r.querySelector(".status-text").innerHTML =
        `Du <b>${this._fmt(c.sensor_debut)}</b><br>au <b>${this._fmt(c.sensor_fin)}</b>`;
      r.querySelector('[data-act="edit"]').textContent = this._editing ? "Annuler" : "Modifier";
    }
    r.querySelector(".form").hidden = on && !this._editing;
    r.querySelector('[data-act="on"]').textContent = on
      ? "Enregistrer les nouvelles dates"
      : "Activer le mode vacances";
    r.querySelector('[data-act="off"]').disabled = !!this._pending;
  }
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 16px; overflow: hidden; }
  [hidden] { display: none !important; }

  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .head ha-icon { color: var(--primary-color); }
  .title { flex: 1; font-size: 1.15em; font-weight: 500; color: var(--primary-text-color); }
  .chip {
    font-size: 0.8em; padding: 4px 10px; border-radius: 999px;
    background: var(--secondary-background-color); color: var(--secondary-text-color);
    white-space: nowrap; max-width: 55%; overflow: hidden; text-overflow: ellipsis;
  }
  .chip.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .chip.busy { color: var(--primary-color); }
  .chip.warn { color: var(--error-color); }

  .status {
    display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
    padding: 12px; margin-bottom: 12px; border-radius: 12px;
    background: var(--secondary-background-color);
  }
  .status-text { flex: 1 1 160px; line-height: 1.5; color: var(--primary-text-color); }
  .actions { display: flex; gap: 8px; }

  .form { display: flex; flex-direction: column; gap: 8px; }
  .slot-label {
    flex: 0 0 42px; font-size: 0.9em; font-weight: 500; color: var(--secondary-text-color);
  }
  .row { display: flex; align-items: center; gap: 8px; }

  .date, .time-btn {
    box-sizing: border-box; height: 40px; font: inherit; font-size: 1em;
    color: var(--primary-text-color); background: var(--secondary-background-color);
    border: 1px solid var(--divider-color); border-radius: 10px;
  }
  .date { flex: 1 1 auto; min-width: 0; padding: 0 10px; color-scheme: light dark; }
  .time-btn {
    flex: 0 0 auto; width: 72px; padding: 0; cursor: pointer;
    font-variant-numeric: tabular-nums; font-weight: 500;
  }
  .date:focus, .time-btn:focus-visible, .time-btn.open {
    outline: 2px solid var(--primary-color); outline-offset: -1px;
  }

  .picker {
    display: flex; align-items: center; justify-content: center; gap: 16px;
    margin-top: 8px; padding: 4px 0;
  }
  .btn.ok { height: 36px; }
  .time { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
  .sep { font-size: 1.4em; font-weight: 600; color: var(--primary-text-color); }

  .wheel { position: relative; width: 56px; height: ${ITEM_H * VISIBLE}px; }
  .wheel-band {
    position: absolute; left: 0; right: 0; top: ${PAD * ITEM_H}px; height: ${ITEM_H}px;
    border-radius: 10px; background: var(--secondary-background-color);
    border: 1px solid var(--divider-color); box-sizing: border-box; pointer-events: none;
  }
  .wheel-scroll {
    position: relative; height: 100%; overflow-y: auto; overscroll-behavior: contain;
    scroll-snap-type: y mandatory; scrollbar-width: none; outline: none;
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent);
            mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent);
  }
  .wheel-scroll::-webkit-scrollbar { display: none; }
  .wheel:focus-within .wheel-band { border-color: var(--primary-color); }
  .wheel-item {
    height: ${ITEM_H}px; line-height: ${ITEM_H}px; text-align: center; scroll-snap-align: center;
    font-size: 1.1em; font-variant-numeric: tabular-nums; cursor: pointer; user-select: none;
    color: var(--secondary-text-color); transition: color .15s, font-size .15s;
  }
  .wheel-item.sel { color: var(--primary-text-color); font-size: 1.35em; font-weight: 600; }
  .wheel-input {
    position: absolute; left: 0; right: 0; top: ${PAD * ITEM_H}px; height: ${ITEM_H}px;
    box-sizing: border-box; text-align: center; font: inherit; font-size: 1.35em; font-weight: 600;
    color: var(--primary-text-color); background: var(--card-background-color);
    border: 2px solid var(--primary-color); border-radius: 10px; outline: none;
  }

  .summary { font-size: 0.9em; color: var(--secondary-text-color); min-height: 1.2em; text-align: center; }
  .summary.error { color: var(--error-color); }

  .btn {
    font: inherit; font-weight: 500; border: none; border-radius: 999px; cursor: pointer;
    padding: 0 18px; height: 40px;
  }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn.primary {
    width: 100%; height: 42px; background: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  .btn.ghost { background: transparent; color: var(--primary-color); border: 1px solid var(--divider-color); }
  .btn.danger { background: var(--error-color); color: #fff; }
`;

customElements.define("toug-vacances-card", TougVacancesCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "toug-vacances-card",
  name: "TOUG - Mode vacances",
  description: "Programmation du mode vacances du T.One avec sélecteurs rotatifs",
});

console.info(`%c TOUG-VACANCES-CARD %c ${VERSION} `, "background:#03a9f4;color:#fff", "");
