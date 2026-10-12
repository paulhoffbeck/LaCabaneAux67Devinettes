import { LitElement, html, css } from 'lit'
import 'jcb-gauge'

// Part du temps restant au-dessus de laquelle la jauge est verte,
// et en dessous de laquelle elle devient rouge (orange entre les deux).
const GREEN_FROM = 0.5
const RED_BELOW = 0.25

/**
 * <timer-gauge duration-ms="20000" deadline="1760270000000"></timer-gauge>
 *
 * deadline : échéance en millisecondes, horloge locale (voir localDeadline dans socketClient.js).
 * Émet l'événement "timeout" une fois le temps écoulé.
 */
export class TimerGauge extends LitElement {
  static properties = {
    durationMs: { type: Number, attribute: 'duration-ms' },
    deadline: { type: Number },
    remaining: { state: true },
  }

  static styles = css`
    /* Fond clair : les couleurs de texte de jcb-gauge sont prévues pour un fond blanc */
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
    // Nouvelle question : on réarme l'événement timeout
    if (changed.has('deadline')) this._timedOut = false
  }

  _tick = () => {
    const remaining = Math.max(0, this.deadline - Date.now())
    // On ne redessine que tous les dixièmes de seconde
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

    // jcb-gauge compare une valeur à une norme (deux trapèzes) :
    // valeur dans le noyau de la norme = vert, dans son support = orange, en dehors = rouge.
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
