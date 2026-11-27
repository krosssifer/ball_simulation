'use strict';

/* ------------------------------------------------------------------
 * Settings panel UI. Controls are generated from a schema and bound
 * to the config object by dotted path (e.g. "scene.circleSize").
 * Every change calls onChange(path, value) so main.js can apply it
 * live to the simulation and persist it.
 * ------------------------------------------------------------------ */

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o[k], obj);
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  const last = ks.pop();
  ks.reduce((o, k) => o[k], obj)[last] = val;
}
function trimNum(v) {
  return String(parseFloat(Number(v).toFixed(2)));
}

const SCHEMA = [
  {
    id: 'scene', title: 'Сцена', open: true,
    controls: [
      { type: 'slider', path: 'scene.circleSize', label: 'Размер окружности', min: 140, max: 460, step: 1, unit: 'px' },
      { type: 'slider', path: 'scene.wallThickness', label: 'Толщина стенки', min: 6, max: 30, step: 1, unit: 'px' },
      { type: 'slider', path: 'scene.ringCount', label: 'Количество окружностей', min: 1, max: 5, step: 1 },
      { type: 'slider', path: 'scene.ringSpacing', label: 'Расстояние между окружностями', min: 50, max: 170, step: 1, unit: 'px', when: c => c.scene.ringCount > 1 },
      { type: 'slider', path: 'scene.holeSize', label: 'Размер отверстия', min: 8, max: 70, step: 1, unit: '°' },
      { type: 'slider', path: 'scene.holePosition', label: 'Положение отверстия', min: 0, max: 359, step: 1, unit: '°' },
      { type: 'slider', path: 'scene.holeOffset', label: 'Смещение отверстий', min: 0, max: 180, step: 1, unit: '°', when: c => c.scene.ringCount > 1 },
      { type: 'toggle', path: 'scene.rotationEnabled', label: 'Вращение окружностей' },
      { type: 'segmented', path: 'scene.rotationDirection', label: 'Направление вращения', when: c => c.scene.rotationEnabled,
        options: [{ v: -1, l: 'Против часовой' }, { v: 1, l: 'По часовой' }] },
      { type: 'slider', path: 'scene.rotationSpeed', label: 'Скорость вращения', min: 5, max: 180, step: 1, unit: '°/с', when: c => c.scene.rotationEnabled }
    ]
  },
  {
    id: 'balls', title: 'Шарики', open: false,
    controls: [
      { type: 'segmented', path: 'balls.spawnMode', label: 'Режим появления',
        options: [
          { v: 'single', l: 'Один' },
          { v: 'multiple', l: 'Несколько' },
          { v: 'sequential', l: 'Последовательно' }
        ] },
      { type: 'slider', path: 'balls.count', label: 'Количество шариков', min: 2, max: 20, step: 1,
        when: c => c.balls.spawnMode === 'multiple' || (c.balls.spawnMode === 'sequential' && !c.balls.infiniteSpawn) },
      { type: 'toggle', path: 'balls.infiniteSpawn', label: 'Бесконечное появление', when: c => c.balls.spawnMode === 'sequential' },
      { type: 'slider', path: 'balls.spawnInterval', label: 'Интервал появления', min: 0.3, max: 10, step: 0.1, unit: 'с', when: c => c.balls.spawnMode === 'sequential' },
      { type: 'slider', path: 'balls.size', label: 'Размер шарика', min: 6, max: 30, step: 1, unit: 'px' },
      { type: 'slider', path: 'balls.mass', label: 'Масса', min: 0.2, max: 5, step: 0.1 },
      { type: 'slider', path: 'balls.initialSpeed', label: 'Начальная скорость', min: 50, max: 800, step: 10, unit: 'px/s' },
      { type: 'slider', path: 'balls.restitution', label: 'Упругость', min: 0, max: 1, step: 0.01 },
      { type: 'color', path: 'balls.color', label: 'Цвет шарика' },
      { type: 'slider', path: 'balls.glow', label: 'Свечение', min: 0, max: 1, step: 0.05 },
      { type: 'slider', path: 'balls.trailLength', label: 'Длина следа', min: 0, max: 40, step: 1 }
    ]
  },
  {
    id: 'physics', title: 'Физика', open: false,
    controls: [
      { type: 'segmented', path: 'physics.mode', label: 'Режим физики',
        options: [
          { v: 'realistic', l: 'Реалистичная' },
          { v: 'arcade', l: 'Аркадная' }
        ] },
      { type: 'slider', path: 'physics.gravity', label: 'Сила гравитации', min: 0, max: 800, step: 10, unit: 'px/s²' },
      { type: 'slider', path: 'physics.gravityDirection', label: 'Направление гравитации', min: 0, max: 359, step: 1, unit: '°' },
      { type: 'slider', path: 'physics.drag', label: 'Сопротивление воздуха', min: 0, max: 0.5, step: 0.005 },
      { type: 'slider', path: 'physics.friction', label: 'Трение', min: 0, max: 0.5, step: 0.005 },
      { type: 'slider', path: 'physics.energyRetention', label: 'Сохранение энергии', min: 0, max: 1, step: 0.05 },
      { type: 'slider', path: 'balls.restitution', label: 'Упругость столкновений', min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    id: 'behavior', title: 'Поведение', open: false,
    controls: [
      { type: 'segmented', path: 'behavior.endMode', label: 'После выхода шарика',
        options: [
          { v: 'infinite', l: 'Бесконечная' },
          { v: 'auto', l: 'Автоперезапуск' },
          { v: 'stop', l: 'Остановка' }
        ] },
      { type: 'segmented', path: 'behavior.speed', label: 'Скорость воспроизведения',
        options: [
          { v: 0.25, l: '0.25x' }, { v: 0.5, l: '0.5x' }, { v: 1, l: '1x' },
          { v: 2, l: '2x' }, { v: 4, l: '4x' }
        ] }
    ]
  },
  {
    id: 'appearance', title: 'Внешний вид', open: false,
    controls: [
      { type: 'segmented', path: 'appearance.theme', label: 'Тема',
        options: [
          { v: 'minimal', l: 'Minimal Dark' },
          { v: 'neon', l: 'Neon Physics' },
          { v: 'clean', l: 'Clean Physics' }
        ] },
      { type: 'color', path: 'balls.color', label: 'Цветовая палитра шариков' },
      { type: 'slider', path: 'appearance.glowIntensity', label: 'Интенсивность свечения', min: 0, max: 1.5, step: 0.05 },
      { type: 'slider', path: 'appearance.trailIntensity', label: 'Интенсивность следов', min: 0, max: 2, step: 0.05 },
      { type: 'toggle', path: 'appearance.effectsEnabled', label: 'Визуальные эффекты' }
    ]
  },
  {
    id: 'control', title: 'Управление', open: false,
    controls: [
      { type: 'buttons', buttons: [
        { action: 'pause', label: 'Пауза', wide: false },
        { action: 'restart', label: 'Перезапуск', wide: false },
        { action: 'addBall', label: 'Добавить шарик', wide: false },
        { action: 'clear', label: 'Очистить сцену', wide: false },
        { action: 'reset', label: 'Сброс настроек', wide: true, danger: true }
      ] },
      { type: 'note', text: 'Масса шарика влияет на столкновения: тяжёлые шарики сильнее отталкивают лёгкие. Отверстие — настоящий проём в стенке: шарик проходит только если целиком помещается в него.' }
    ]
  }
];

class PanelUI {
  constructor(root, cfg, onChange, actions) {
    this.root = root;
    this.cfg = cfg;
    this.onChange = onChange;
    this.actions = actions;
    this.controls = [];
    this.build();
  }

  build() {
    this.root.innerHTML = '';
    this.controls = [];
    for (const section of SCHEMA) {
      const det = document.createElement('details');
      det.className = 'section';
      if (section.open) det.open = true;
      const sum = document.createElement('summary');
      sum.textContent = section.title;
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'section-body';
      for (const def of section.controls) {
        body.appendChild(this.buildControl(def));
      }
      det.appendChild(body);
      this.root.appendChild(det);
    }
  }

  buildControl(def) {
    if (def.type === 'note') {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = def.text;
      return p;
    }
    if (def.type === 'buttons') {
      const grid = document.createElement('div');
      grid.className = 'btn-grid';
      for (const b of def.buttons) {
        const btn = document.createElement('button');
        btn.className = 'btn' + (b.wide ? ' wide' : '') + (b.danger ? ' danger' : '');
        btn.textContent = b.label;
        btn.addEventListener('click', () => this.actions[b.action]());
        grid.appendChild(btn);
        if (b.action === 'pause') this.pauseBtn = btn;
      }
      return grid;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ctl';

    if (def.type === 'slider') {
      const head = document.createElement('div');
      head.className = 'ctl-head';
      const label = document.createElement('label');
      label.textContent = def.label;
      const val = document.createElement('span');
      val.className = 'val';
      head.appendChild(label);
      head.appendChild(val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = def.min; input.max = def.max; input.step = def.step;
      const fmt = v => def.unit ? trimNum(v) + ' ' + def.unit : trimNum(v);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        setPath(this.cfg, def.path, v);
        val.textContent = fmt(v);
        this.onChange(def.path, v);
      });
      wrap.appendChild(head);
      wrap.appendChild(input);
      this.controls.push({
        def, el: wrap,
        refresh: () => {
          const v = getPath(this.cfg, def.path);
          input.value = v;
          val.textContent = fmt(v);
        }
      });
    } else if (def.type === 'segmented') {
      const label = document.createElement('label');
      label.textContent = def.label;
      label.style.display = 'block';
      label.style.marginBottom = '6px';
      label.style.fontSize = '13px';
      const seg = document.createElement('div');
      seg.className = 'seg';
      const btns = [];
      for (const opt of def.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = opt.l;
        btn.addEventListener('click', () => {
          setPath(this.cfg, def.path, opt.v);
          this.onChange(def.path, opt.v);
          this.refresh();
        });
        seg.appendChild(btn);
        btns.push({ btn, v: opt.v });
      }
      wrap.appendChild(label);
      wrap.appendChild(seg);
      this.controls.push({
        def, el: wrap,
        refresh: () => {
          const v = getPath(this.cfg, def.path);
          for (const b of btns) b.btn.classList.toggle('active', b.v === v);
        }
      });
    } else if (def.type === 'toggle') {
      const row = document.createElement('label');
      row.className = 'switch-row';
      const lab = document.createElement('span');
      lab.className = 'switch-label';
      lab.textContent = def.label;
      const sw = document.createElement('span');
      sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      const track = document.createElement('span');
      track.className = 'track';
      sw.appendChild(input);
      sw.appendChild(track);
      row.appendChild(lab);
      row.appendChild(sw);
      input.addEventListener('change', () => {
        setPath(this.cfg, def.path, input.checked);
        this.onChange(def.path, input.checked);
      });
      wrap.appendChild(row);
      this.controls.push({
        def, el: wrap,
        refresh: () => { input.checked = !!getPath(this.cfg, def.path); }
      });
    } else if (def.type === 'color') {
      const head = document.createElement('div');
      head.className = 'ctl-head';
      const label = document.createElement('label');
      label.textContent = def.label;
      head.appendChild(label);
      const row = document.createElement('div');
      row.className = 'color-row';
      const input = document.createElement('input');
      input.type = 'color';
      input.addEventListener('input', () => {
        setPath(this.cfg, def.path, input.value);
        this.onChange(def.path, input.value);
        this.refresh();
      });
      row.appendChild(input);
      const swWrap = document.createElement('div');
      swWrap.className = 'swatches';
      const swBtns = [];
      for (const p of PALETTES) {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'swatch';
        s.style.background = p.value;
        s.title = p.name;
        s.setAttribute('aria-label', p.name);
        s.addEventListener('click', () => {
          setPath(this.cfg, def.path, p.value);
          this.onChange(def.path, p.value);
          this.refresh();
        });
        swWrap.appendChild(s);
        swBtns.push({ el: s, value: p.value });
      }
      row.appendChild(swWrap);
      wrap.appendChild(head);
      wrap.appendChild(row);
      this.controls.push({
        def, el: wrap,
        refresh: () => {
          const v = getPath(this.cfg, def.path);
          input.value = v;
          for (const s of swBtns) {
            s.el.classList.toggle('active', s.value.toLowerCase() === String(v).toLowerCase());
          }
        }
      });
    }
    return wrap;
  }

  refresh() {
    for (const c of this.controls) {
      if (c.def.when) c.el.style.display = c.def.when(this.cfg) ? '' : 'none';
      c.refresh();
    }
  }

  setPaused(paused) {
    if (this.pauseBtn) this.pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
  }
}
