import { settings, updateSettings, type Settings } from '../settings.js';
import { h } from './dom.js';

type VolumeKey = 'master' | 'sfx' | 'ambience';
type ToggleKey = 'muted' | 'crt' | 'reducedEffects' | 'mouseLook';

/** The settings window: sound levels and screen options. Open it with the gear buttons. */
class SettingsPanel {
  readonly el = h('div', {
    class: 'settings-backdrop hidden',
    onclick: (e: Event) => {
      if (e.target === this.el) this.close();
    },
  });

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  open(): void {
    this.render();
    this.el.classList.remove('hidden');
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  private render(): void {
    this.el.replaceChildren(
      h(
        'div',
        { class: 'panel settings' },
        h(
          'div',
          { class: 'settings-head' },
          h('h2', {}, 'Settings'),
          h('button', { class: 'tiny', title: 'Close (Esc)', onclick: () => this.close() }, '✕'),
        ),
        h('h3', {}, 'Sound'),
        this.slider('Master', 'master'),
        this.slider('Effects', 'sfx'),
        this.slider('Ambience', 'ambience'),
        this.toggle('Mute everything', 'muted'),
        h('h3', {}, 'Screen'),
        this.toggle('CRT scanlines', 'crt'),
        this.toggle('Reduced screen effects', 'reducedEffects', 'Less shake, flashing, glitching and lamp strobing.'),
        this.toggle('Look around with the mouse', 'mouseLook'),
        h('p', { class: 'settings-note' }, 'Saved in this browser.'),
      ),
    );
  }

  private slider(label: string, key: VolumeKey): HTMLElement {
    const value = h('span', { class: 'setting-value' }, `${Math.round(settings[key] * 100)}%`);
    const input = h('input', {
      type: 'range',
      min: 0,
      max: 100,
      value: String(Math.round(settings[key] * 100)),
      oninput: () => {
        // Update in place: re-rendering would interrupt the drag.
        value.textContent = `${input.value}%`;
        updateSettings({ [key]: Number(input.value) / 100 } as Partial<Settings>);
      },
    });
    return h('label', { class: 'setting' }, h('span', { class: 'setting-label' }, label), input, value);
  }

  private toggle(label: string, key: ToggleKey, hint?: string): HTMLElement {
    const on = settings[key];
    return h(
      'button',
      {
        class: `setting-toggle${on ? ' on' : ''}`,
        title: hint,
        'aria-pressed': String(on),
        onclick: () => {
          updateSettings({ [key]: !settings[key] } as Partial<Settings>);
          this.render();
        },
      },
      h('span', { class: 'box' }, on ? '■' : '□'),
      label,
      hint ? h('span', { class: 'setting-hint' }, hint) : null,
    );
  }
}

export const settingsPanel = new SettingsPanel();

/** A gear button that opens the settings. */
export function settingsButton(extraClass = ''): HTMLButtonElement {
  return h('button', { class: `gear ${extraClass}`.trim(), title: 'Settings', onclick: () => settingsPanel.open() }, '⚙');
}
