
  var pass = 0, total = 0, lines = [];
  function check(name, ok, detail) {
    total++; if (ok) pass++;
    lines.push((ok ? 'PASS' : 'FAIL') + '  ' + name + '   (' + (detail === undefined ? '' : detail) + ')');
    document.getElementById('report').textContent = '画布交互 v24：' + pass + '/' + total + ' PASS\n' + lines.join('\n');
  }
  function q(s) { return document.querySelector(s); }
  function qa(s) { return document.querySelectorAll(s); }
  function ed() { return q('.dsh-wf-fg-editor'); }
  function nodeCount() { return qa('.dsh-wf-fg-node').length; }
  function pos(id) { var p = window.__df_node_pos && window.__df_node_pos(id); return p ? Math.round(p.x) + ',' + Math.round(p.y) : 'null'; }
  function liveCard() { var n = q('.dsh-wf-fg-node'); return n ? (n.querySelector('.dsh-wf-fg-card') || n) : null; }
  function cardCenter(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }

  function realTap(el, x, y) {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
  }
  function dragSeq(el, x1, y1, x2, y2, cb) {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: x1, clientY: y1, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x1, clientY: y1, button: 0 }));
    setTimeout(function () {
      for (var i = 1; i <= 3; i++) {
        var mx = x1 + (x2 - x1) * i / 3, my = y1 + (y2 - y1) * i / 3;
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, view: window, clientX: mx, clientY: my, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: mx, clientY: my }));
      }
      setTimeout(function () {
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, clientX: x2, clientY: y2, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x2, clientY: y2, button: 0 }));
        setTimeout(cb, 400);
      }, 150);
    }, 150);
  }

  // 自动保存计数：包装 fetch 统计 /workflows/save 的 POST
  window.__df_save_calls = 0;
  var _origFetch = window.fetch;
  window.fetch = function (url, opts) {
    if (String(url).indexOf('/workflows/save') >= 0 && opts && opts.method === 'POST') window.__df_save_calls++;
    return _origFetch.apply(this, arguments);
  };

  var tries = 0;
  (function whenReady() {
    var e = ed();
    var nds = e ? e.querySelectorAll('.dsh-wf-fg-node') : [];
    if (nds.length >= 2 && window.__df_node_pos) return void setTimeout(run, 1200);
    if (tries++ < 120) return void setTimeout(whenReady, 50);
    check('画布渲染', false, 'timeout');
    finish();
  })();

  function finish() {
    document.getElementById('report').textContent += '\n— done —';
    try { fetch('/report', { method: 'POST', body: document.getElementById('report').textContent }); } catch (e) {}
  }

  function run() {
    try { return void runBody(); } catch (err) {
      check('run() 异常', false, String((err && err.message) || err));
      finish();
    }
  }

  function runBody() {
    var card = liveCard();
    var c = cardCenter(card);
    // 1 单击选中（右面板出现节点编辑）
    realTap(card, c.x, c.y);
    setTimeout(function () {
      var right = q('.dsh-wf-right');
      var inspectorShown = !!right && right.textContent.indexOf('节点 ID') >= 0;
      check('1 单击节点右面板显示参数编辑', inspectorShown, 'inspector=' + inspectorShown);
      var selCard = q('.dsh-wf-fg-card');
      var cs = getComputedStyle(selCard);
      check('2 节点卡选中态醒目(fg-selected+2px描边+1.05放大)', String(selCard.className).indexOf('fg-selected') >= 0
        && cs.outlineWidth === '2px' && cs.outlineStyle === 'solid' && cs.transform.indexOf('1.05') >= 0,
        'outline=' + cs.outlineWidth + '/' + cs.outlineStyle + ' transform=' + cs.transform);

      // 3 按住拖拽
      var before = pos('start');
      c = cardCenter(liveCard());
      dragSeq(liveCard(), c.x, c.y, c.x + 160, c.y + 90, function () {
        var after = pos('start');
        check('3 按住拖拽移动节点', before !== after && after !== 'null', before + ' -> ' + after);

        // 4 双击不再拿起（无提示条、节点不消失）
        c = cardCenter(liveCard());
        var dblBefore = pos('start');
        realTap(liveCard(), c.x, c.y);
        realTap(liveCard(), c.x, c.y);
        liveCard().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y, button: 0 }));
        setTimeout(function () {
          var noHint = !q('.dsh-wf-fg-carry-hint') && document.body.className.indexOf('dsh-wf-fg-carrying') < 0;
          check('4 双击无拿起逻辑', noHint && pos('start') === dblBefore, 'hint=false pos稳定');

          // 5 Del 守卫：输入框内 Delete 不删
          var inp = q('.dsh-wf-fg-palette-search');
          var cnt = nodeCount();
          if (inp) inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
          setTimeout(function () {
            check('5 输入框内 Delete 不误删', pos('start') !== 'null' && nodeCount() === cnt, 'count=' + nodeCount());

            // 6 Del 删除选中节点（dispose 同步移除 + def 层同步更新）
            q('.dsh-wf-fg-node').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
            setTimeout(function () {
              var defNodes = window.__df_def && window.__df_def.nodes ? window.__df_def.nodes.length : null;
              check('6 Del 删除选中节点', defNodes === 1 && (pos('start') === 'null' || nodeCount() === 1),
                'defN=' + defNodes + ' canvas=' + nodeCount());

              // 7 右面板最小化（» 竖条）
              var minBtn = q('.dsh-wf-right .dsh-wf-right-min');
              if (minBtn) minBtn.click();
              setTimeout(function () {
                var rp = q('.dsh-wf-right');
                var minified = !!rp && rp.className.indexOf('min') >= 0;
                check('7 右面板最小化(竖条)', minified, 'class=' + (rp ? rp.className : 'none'));

                // 8 最小化状态下单击节点 → 自动展开 + 显示参数
                var ns = qa('.dsh-wf-fg-node');
                var last = ns[ns.length - 1];
                var endCard = last ? (last.querySelector('.dsh-wf-fg-card') || last) : null;
                var ec = cardCenter(endCard);
                realTap(endCard, ec.x, ec.y);
                setTimeout(function () {
                  var rp2 = q('.dsh-wf-right');
                  var expanded = !!rp2 && rp2.className.indexOf('min') < 0 && rp2.textContent.indexOf('节点 ID') >= 0;
                  check('8 最小化时点击节点自动展开', expanded, 'expanded=' + expanded);

                  // 9 点击画布空白处 → 取消选中（高亮消失 + 右面板回占位符）
                  var er = ed().getBoundingClientRect();
                  var empty = { x: Math.round(er.left + 380), y: Math.round(er.top + 700) };
                  ed().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: empty.x, clientY: empty.y, button: 0 }));
                  ed().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: empty.x, clientY: empty.y, button: 0 }));
                  setTimeout(function () {
                    var noSel = !q('.dsh-wf-fg-card.fg-selected');
                    var rText = (q('.dsh-wf-right') || {}).textContent || '';
                    check('9 点击空白取消选中', noSel && rText.indexOf('点击节点') >= 0,
                      'noFgSelected=' + noSel + ' placeholder=' + (rText.indexOf('点击节点') >= 0));

                    // 10/11 palette 最小化/展开
                  var minBtn2 = q('.dsh-wf-fg-palette .dsh-wf-fg-palette-min');
                  if (minBtn2) minBtn2.click();
                  setTimeout(function () {
                    var pal = q('.dsh-wf-fg-palette');
                    check('10 面板最小化(竖条+无列表)', !!pal && pal.className.indexOf('min') >= 0 && !pal.querySelector('.dsh-wf-fg-palette-list'), 'class=' + (pal ? pal.className : 'none'));
                    var expBtn = q('.dsh-wf-fg-palette .dsh-wf-fg-palette-min-btn');
                    if (expBtn) expBtn.click();
                    setTimeout(function () {
                      var pal2 = q('.dsh-wf-fg-palette');
                      check('11 点竖条展开面板', !!pal2 && pal2.className.indexOf('min') < 0 && !!pal2.querySelector('.dsh-wf-fg-palette-list'), 'class=' + (pal2 ? pal2.className : 'none'));
                      // 12 自动保存：Del 后 dirty → 2s 防抖到期 → POST save + 状态回「已保存」
                      setTimeout(function () {
                        var saveOk = (window.__df_save_calls ?? 0) >= 1;
                        // 头部有多个 .dsh-wf-title-sub（节点计数 + 保存状态），任一为「✓ 已保存」即可
                        var subs = qa('.dsh-wf-title-sub');
                        var label = '';
                        for (var i = 0; i < subs.length; i++) { label += subs[i].textContent + '|'; }
                        var savedShown = label.indexOf('✓ 已保存') >= 0;
                        check('12 自动保存落盘+状态回已保存', saveOk && savedShown, 'saveCalls=' + (window.__df_save_calls ?? 0) + ' subs=' + label);
                        finish();
                      }, 3200);   // T11 自动保存
                    }, 250);      // T10 palette 展开
                  }, 250);        // T9 palette 最小化
                }, 300);          // T8 deselect 空白点击
              }, 300);            // T7 自动展开检查
            }, 250);              // T6 右面板最小化检查
          }, 500);                // T5 Del 删除检查
        }, 400);                  // T4 输入守卫检查
      }, 300);                    // T3 双击检查
    }, 400);                      // T1 单击选中检查
  }
