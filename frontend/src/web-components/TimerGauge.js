import { LitElement, html, css } from 'lit'
import 'jcb-gauge'

// vert tant qu'il reste plus de la moitié du temps, rouge sous 25 %, orange entre les deux
const GREEN_FROM = 0.5
const RED_BELOW = 0.25

// utilisation : <timer-gauge duration-ms="20000" deadline="...">, envoie "timeout" quand c'est fini
export class TimerGauge extends LitElement {
  static properties = {
    durationMs: { type: Number, attribute: 'duration-ms' },
    deadline: { type: Number },
    remaining: { state: true },
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      padding: 0.5em;
      border-radius: 1em;
      background: #fff;
    }
  `

  constructor() {
    super()
    this.durationMs = 0
    this.deadline = 0
    this.remaining = 0
    this._frame = null
    this._timedOut = false
  }

  connectedCallback() {
    super.connectedCallback()
    this._tick()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    cancelAnimationFrame(this._frame)
  }

  willUpdate(changed) {
    if (changed.has('deadline')) this._timedOut = false
  }

  _tick = () => {
    const remaining = Math.max(0, this.deadline - Date.now())
    if (Math.abs(remaining - this.remaining) >= 100 || remaining === 0) this.remaining = remaining

    if (remaining === 0 && this.deadline && !this._timedOut) {
      this._timedOut = true
      this.dispatchEvent(new CustomEvent('timeout', { bubbles: true, composed: true }))
    }
    this._frame = requestAnimationFrame(this._tick)
  }

  render() {
    const total = Math.max(1, this.durationMs) / 1000
    const left = this.remaining / 1000

    // jcb-gauge marche avec une "norme" : dans le noyau = vert, dans le support = orange, sinon rouge
    const domain = { inf: 0, sup: total }
    const norm = { d1: total * GREEN_FROM, d2: total, dt1: total * (GREEN_FROM - RED_BELOW), dt2: 0, h: 0 }
    const value = { d1: left, d2: left, dt1: 0, dt2: 0, h: 0 }

    return html`
      <jcb-gauge
        .domain=${domain}
        .norm=${norm}
        .value=${value}
        .title=${String(Math.ceil(left))}
        subtitle="secondes"
      ></jcb-gauge>
    `
  }
}

customElements.define('timer-gauge', TimerGauge)
