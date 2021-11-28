'use strict';

/**
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

/**
 * Copyright 2009 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const Changeset = require('./Changeset');
const _ = require('./underscore');

const undoModule = (() => {
  console.log('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  const stack = (() => {
    const stackElements = [];
    // two types of stackElements:
    // 1) { elementType: UNDOABLE_EVENT, eventType: "anything", [backset: <changeset>,]
    //      [selStart: <char number>, selEnd: <char number>, selFocusAtStart: <boolean>] }
    // 2) { elementType: EXTERNAL_CHANGE, changeset: <changeset> }
    // invariant: no two consecutive EXTERNAL_CHANGEs
    let numUndoableEvents = 0;

    const UNDOABLE_EVENT = 'undoableEvent';
    const EXTERNAL_CHANGE = 'externalChange';

    const clearStack = () => {
      stackElements.length = 0;
      stackElements.push(
          {
            elementType: UNDOABLE_EVENT,
            eventType: 'bottom',          // 这是垫底的
          });
      numUndoableEvents = 1;
    };
    clearStack();

    const pushEvent = (event) => {
      const e = _.extend(
          {}, event);
      e.elementType = UNDOABLE_EVENT;
      // console.log('push', e, stackElements);
      stackElements.push(e);
      numUndoableEvents++;
      // dmesg("pushEvent backset: "+event.backset);
    };

    // 收到别的 client 的 op 时，会调用 pushExternalChange 将 ex 推入 stack
    // 定时器下一次调用 reportEvent（里面会调用 _exposeEvent），_exposeEvent 就会把所有栈顶的 ex 往栈底推，推的过程中就会进行 transform
    const pushExternalChange = (cs) => {
      console.log('pushExternalChange');

      const idx = stackElements.length - 1;
      // 如果栈顶 event 也是 EXTERNAL_CHANGE，直接 compose 两个 cs
      if (stackElements[idx].elementType === EXTERNAL_CHANGE) {
        stackElements[idx].changeset =
            Changeset.compose(stackElements[idx].changeset, cs, getAPool());
      } else {
        stackElements.push(
            {
              elementType: EXTERNAL_CHANGE,
              changeset: cs,
            });
      }
    };

    // ********************************************************* 重点 *********************************************************
    // 取出距离栈顶 nthFromTop 的元素或者弹出栈顶元素的时候会调用
    const _exposeEvent = (nthFromTop) => {
      console.log('_exposeEvent', stackElements);
      // precond: 0 <= nthFromTop < numUndoableEvents
      const targetIndex = stackElements.length - 1 - nthFromTop;
      let idx = stackElements.length - 1;

      // 从栈顶往下遍历，跳过 UNDOABLE_EVENT，合并 ex
      // 保证 targetIndex 拿到的 UNDOABLE_EVENT 后面没有任何 ex（都被合并到了 targetIndex - 1 的 ex 里）
      // 也就是，targetIndex 拿到的一定是距离栈顶的第 nthFromTop 个 UNDOABLE_EVENT，且前 nthFromTop - 1 个也都是 UNDOABLE_EVENT

      // 什么时候会 idx > targetIndex 不成立但 stackElements[idx].elementType === EXTERNAL_CHANGE 成立？
      // 答案：idx === targetIndex && stackElements[idx].elementType === EXTERNAL_CHANGE
      // 如果 targetIndex 指向的也是一个 ex，也需要向前置换一个 undo 过来
      while (idx > targetIndex || stackElements[idx].elementType === EXTERNAL_CHANGE) {
        if (stackElements[idx].elementType === EXTERNAL_CHANGE) {
          const ex = stackElements[idx];
          const un = stackElements[idx - 1];  // 一定会是 undo，因为连续的 ex 会合并
          if (un.backset) {
            const excs = ex.changeset;
            const unbs = un.backset;

            // un.backset' 要加上 ex.changeset 的影响
            console.log('Starting follow un.backset ——————————————————');
            console.log('before::: un.backset: ', un.backset, ' excs: ', excs);
            un.backset = Changeset.follow(excs, un.backset, false, getAPool());
            console.log('after::: un.backset: ', un.backset, ' excs: ', excs);

            // ex.changeset' 要去除 un.changeset 的影响
            console.log('Starting follow ex.changeset ——————————————————');
            console.log('before::: unbs: ', unbs, ' ex.changeset: ', ex.changeset);
            ex.changeset = Changeset.follow(unbs, ex.changeset, true, getAPool());
            console.log('after::: unbs: ', unbs, ' ex.changeset: ', ex.changeset);

            if ((typeof un.selStart) === 'number') {
              const newSel = Changeset.characterRangeFollow(excs, un.selStart, un.selEnd);
              un.selStart = newSel[0];
              un.selEnd = newSel[1];
              if (un.selStart === un.selEnd) {
                un.selFocusAtStart = false;
              }
            }
          }
          // ex 和 un 调换位置
          stackElements[idx - 1] = ex;
          stackElements[idx] = un;
          // 如果调换位置后的 ex 前面还是一个 ex，将两个 ex 合并
          if (idx >= 2 && stackElements[idx - 2].elementType === EXTERNAL_CHANGE) {
            ex.changeset =
                Changeset.compose(stackElements[idx - 2].changeset, ex.changeset, getAPool());
            stackElements.splice(idx - 2, 1);
            idx--;  // splice 删了一个 ex，所以要 idx--，idx 此刻指向 un
          }
        } else {
          idx--;
        }
      }
    };

    const getNthFromTop = (n) => {
      // precond: 0 <= n < numEvents()
      _exposeEvent(n);
      return stackElements[stackElements.length - 1 - n];
    };

    const numEvents = () => numUndoableEvents;

    const popEvent = () => {
      // precond: numEvents() > 0
      _exposeEvent(0);
      numUndoableEvents--;
      return stackElements.pop();
    };

    return {
      numEvents,
      popEvent,
      pushEvent,
      pushExternalChange,
      clearStack,
      getNthFromTop,
      stackElements,
    };
  })();

  // invariant: stack always has at least one undoable event
  // 指向下一次应该 undo 的操作
  let undoPtr = 0; // zero-index from top of stack, 0 == top

  const clearHistory = () => {
    stack.clearStack();
    undoPtr = 0;
  };

  const _charOccurrences = (str, c) => {
    let i = 0;
    let count = 0;
    while (i >= 0 && i < str.length) {
      i = str.indexOf(c, i);
      if (i >= 0) {
        count++;
        i++;
      }
    }
    return count;
  };

  const _opcodeOccurrences = (cs, opcode) => _charOccurrences(Changeset.unpack(cs).ops, opcode);

  const _mergeChangesets = (cs1, cs2) => {
    if (!cs1) return cs2;
    if (!cs2) return cs1;

    // Rough heuristic for whether changesets should be considered one action:
    // each does exactly one insertion, no dels, and the composition does also; or
    // each does exactly one deletion, no ins, and the composition does also.
    // A little weird in that it won't merge "make bold" with "insert char"
    // but will merge "make bold and insert char" with "insert char",
    // though that isn't expected to come up.
    const plusCount1 = _opcodeOccurrences(cs1, '+');
    const plusCount2 = _opcodeOccurrences(cs2, '+');
    const minusCount1 = _opcodeOccurrences(cs1, '-');
    const minusCount2 = _opcodeOccurrences(cs2, '-');
    if (plusCount1 === 1 && plusCount2 === 1 && minusCount1 === 0 && minusCount2 === 0) {
      const merge = Changeset.compose(cs1, cs2, getAPool());
      const plusCount3 = _opcodeOccurrences(merge, '+');
      const minusCount3 = _opcodeOccurrences(merge, '-');
      if (plusCount3 === 1 && minusCount3 === 0) {
        return merge;
      }
    } else if (plusCount1 === 0 && plusCount2 === 0 && minusCount1 === 1 && minusCount2 === 1) {
      const merge = Changeset.compose(cs1, cs2, getAPool());
      const plusCount3 = _opcodeOccurrences(merge, '+');
      const minusCount3 = _opcodeOccurrences(merge, '-');
      if (plusCount3 === 0 && minusCount3 === 1) {
        return merge;
      }
    }
    return null;
  };

  // TODO_X 哪些 event 会 report，哪些会入 undo 栈
  // 1. 修改选区相关
  // 2. 鼠标相关
  // 3. 键盘相关
  // 目的：更新选区 / 推入 undo 栈（或跟栈顶事件合并）
  const reportEvent = (event) => {
    // if (event.eventType !== 'idleWorkTimer') {
    // console.log('report', event.eventType);
    // }
    const topEvent = stack.getNthFromTop(0);

    const applySelectionToTop = () => {
      if ((typeof event.selStart) === 'number') {
        topEvent.selStart = event.selStart;
        topEvent.selEnd = event.selEnd;
        topEvent.selFocusAtStart = event.selFocusAtStart;
      }
    };

    if ((!event.backset) || Changeset.isIdentity(event.backset)) {  // 更新选区，undo 操作也会进这里
      applySelectionToTop();
    } else {                                                        // event 是一个可以 undo 的操作，入栈
      // 如果栈顶事件和 event 是同一个 eventType，合并、更新选区
      let merged = false;
      if (topEvent.eventType === event.eventType) {
        const merge = _mergeChangesets(event.backset, topEvent.backset);
        if (merge) {
          topEvent.backset = merge;
          // dmesg("reportEvent merge: "+merge);
          applySelectionToTop();
          merged = true;
        }
      }
      // 如果上一步没有做合并，将新的 event 入栈
      if (!merged) {
        /*
         * Push the event on the undo stack only if it exists, and if it's
         * not a "clearauthorship". This disallows undoing the removal of the
         * authorship colors, but is a necessary stopgap measure against
         * https://github.com/ether/etherpad-lite/issues/2802
         */
        if (event && (event.eventType !== 'clearauthorship')) {
          stack.pushEvent(event);
        }
      }
      undoPtr = 0;
      console.log('xxxxxxxxxxx undoPtr = 0');
    }
  };

  const reportExternalChange = (changeset) => {
    if (changeset && !Changeset.isIdentity(changeset)) {
      stack.pushExternalChange(changeset);
    }
  };

  const _getSelectionInfo = (event) => {
    if ((typeof event.selStart) !== 'number') {
      return null;
    } else {
      return {
        selStart: event.selStart,
        selEnd: event.selEnd,
        selFocusAtStart: event.selFocusAtStart,
      };
    }
  };

  // For "undo" and "redo", the change event must be returned
  // by eventFunc and NOT reported through the normal mechanism.
  // "eventFunc" should take a changeset and an optional selection info object,
  // or can be called with no arguments to mean that no undo is possible.
  // "eventFunc" will be called exactly once.
  // 1. 取出 undoPtr 指向的 UNDOABLE_EVENT
  // 2. 根据这个 UNDOABLE_EVENT 生成 undoEvent（elementType 也是 UNDOABLE_EVENT），推入 stack（eventFunc 里应该执行了具体的撤销操作）
  // 3. 更新 undoPtr
  const performUndo = (eventFunc) => {
    console.log(`BEFORE Undo:: undoPtr: ${undoPtr} stack: `, stack.stackElements);
    if (undoPtr < stack.numEvents() - 1) {
      // 拿到要 undo 的 event
      const backsetEvent = stack.getNthFromTop(undoPtr);
      // backsetEvent 的前一个 event 的选区，即执行这个 backsetEvent 时的选区
      const selectionEvent = stack.getNthFromTop(undoPtr + 1);

      const undoEvent = eventFunc(backsetEvent.backset, _getSelectionInfo(selectionEvent));
      stack.pushEvent(undoEvent);
      // 下一次 undo 的就是更早的操作（1 个是 backsetEvent，1 个是 undoEvent）
      undoPtr += 2;
      console.log(`AFTER Undo:: undoPtr: ${undoPtr}  stack: `, stack.stackElements);
    } else { eventFunc(); }  // 没有操作可以 undo
  };

  // 只有上一个操作是 undo，才能 redo
  // 1. 取出栈顶的 UNDOABLE_EVENT（一定是 undoEvent）
  // 2. eventFunc 执行具体的重做操作
  // 3. 将 undoEvent 弹出栈顶
  // 4. 更新 undoPtr
  const performRedo = (eventFunc) => {
    console.log('preformRedo:: undoPtr: ', undoPtr);
    // undoPtr >= 2 表示先前执行过 undo
    // 如果执行 undo 后又执行了编辑操作，reportEvent() 会重新把 undoPtr 置 0
    if (undoPtr >= 2) {
      const backsetEvent = stack.getNthFromTop(0);
      const selectionEvent = stack.getNthFromTop(1);
      eventFunc(backsetEvent.backset, _getSelectionInfo(selectionEvent));

      stack.popEvent();

      // 1 个是弹出栈顶的 undoEvent，1 个是之前被 undo 现在又被 redo 的那个编辑操作
      undoPtr -= 2;
      console.log(`after redo:: undoPtr: ${undoPtr}  stack: `, stack.stackElements);
    } else { eventFunc(); }
  };

  const getAPool = () => undoModule.apool;

  return {
    clearHistory,
    reportEvent,
    reportExternalChange,
    performUndo,
    performRedo,
    enabled: true,
    apool: null,
  }; // apool is filled in by caller
})();

exports.undoModule = undoModule;
