"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = void 0;
var claude_code_1 = require("claude-code");
var round = (0, claude_code_1.atom)({ plugin: 'grill-answers', key: 'round' }, null);
// The grilling skill's round: `❓ **Q1** - **<title>**: <question>`, then `➡️ <recommended answer>`.
var QUESTION = /❓\s*\*\*Q(\d+)\*\*\s*-\s*\*\*(.+?)\*\*/;
var RECOMMENDATION = /^\s*➡️\s*(.+)$/;
var collapse = function (text) { return text.replace(/\s+/g, ' ').trim(); };
// A button label is plain text: the recommendation without its markdown emphasis and code ticks.
var plain = function (markdown) { return markdown.replace(/\*\*|__|`/g, '').trim(); };
var parseRound = function (answer) {
    var questions = __spreadArray([], answer.matchAll(new RegExp(QUESTION, 'g')), true).map(function (_a) {
        var _b = _a[1], number = _b === void 0 ? '' : _b, _c = _a[2], title = _c === void 0 ? '' : _c;
        return ({
            number: number,
            title: title.replace(/:$/, '').trim(),
        });
    });
    return questions.length > 0 && answer.includes('➡️') ? { answer: collapse(answer), questions: questions, accepted: [] } : null;
};
var pieces = function (block) {
    var _a, _b, _c;
    var out = [];
    var markdown = [];
    var question = '';
    var flush = function () {
        if (markdown.join('\n').trim() !== '') {
            out.push({ kind: 'text', markdown: markdown.join('\n') });
        }
        markdown = [];
    };
    for (var _i = 0, _d = block.split('\n'); _i < _d.length; _i++) {
        var line = _d[_i];
        question = (_b = (_a = line.match(QUESTION)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : question;
        var recommendation = (_c = line.match(RECOMMENDATION)) === null || _c === void 0 ? void 0 : _c[1];
        if (recommendation === undefined || question === '') {
            markdown.push(line);
            continue;
        }
        flush();
        out.push({ kind: 'recommendation', question: question, text: plain(recommendation) });
    }
    flush();
    return out;
};
var register = function (on) {
    on('turn.complete', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!(e.agentId === undefined)) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, claude_code_1.update)($, round, function () { return parseRound(e.answer); })];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/, next(e)];
            }
        });
    }); });
    // Any prompt, clicked or typed, answers the round.
    on('prompt.submit', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, claude_code_1.update)($, round, function () { return null; })];
                case 1:
                    _a.sent();
                    return [2 /*return*/, next(e)];
            }
        });
    }); });
    on('ui.render', { component: 'AssistantMessage' }, function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var current, block, isRoundEnd, _a, Box, Button, isSingle, parts, drawn, _i, _b, _c, index, piece, _d, _e, _f, send, answer, accept, change;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0: return [4 /*yield*/, (0, claude_code_1.read)($, round)];
                case 1:
                    current = _g.sent();
                    block = collapse(e.props.text);
                    isRoundEnd = current !== null && block !== '' && !e.props.isSummary && current.answer.endsWith(block);
                    if (!isRoundEnd) {
                        return [2 /*return*/, next(e)];
                    }
                    _a = $.ui.resolve(e), Box = _a.Box, Button = _a.Button;
                    isSingle = current.questions.length === 1;
                    parts = pieces(e.props.text);
                    drawn = [];
                    _i = 0, _b = parts.entries();
                    _g.label = 2;
                case 2:
                    if (!(_i < _b.length)) return [3 /*break*/, 7];
                    _c = _b[_i], index = _c[0], piece = _c[1];
                    _e = (_d = drawn).push;
                    if (!(piece.kind === 'text')) return [3 /*break*/, 4];
                    return [4 /*yield*/, next(__assign(__assign({}, e), { props: __assign(__assign({}, e.props), { text: piece.markdown, isFirstOfReply: e.props.isFirstOfReply && index === 0 }) }))];
                case 3:
                    _f = _g.sent();
                    return [3 /*break*/, 5];
                case 4:
                    _f = null;
                    _g.label = 5;
                case 5:
                    _e.apply(_d, [_f]);
                    _g.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 2];
                case 7:
                    send = function (text) { return __awaiter(void 0, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: 
                                // The plugin's own submit skips its own prompt.submit hook, so the click retires the buttons itself.
                                return [4 /*yield*/, (0, claude_code_1.update)($, round, function () { return null; })];
                                case 1:
                                    // The plugin's own submit skips its own prompt.submit hook, so the click retires the buttons itself.
                                    _a.sent();
                                    return [4 /*yield*/, $.prompt.submit({ text: text, asUser: true })];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    answer = function (question, text) { return __awaiter(void 0, void 0, void 0, function () {
                        var draft, others;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, $.prompt.read()];
                                case 1:
                                    draft = _a.sent();
                                    others = draft.text.split('\n').filter(function (line) { return line.trim() !== '' && !line.startsWith("Q".concat(question, ":")); });
                                    return [4 /*yield*/, $.prompt.fill({ text: __spreadArray(__spreadArray([], others, true), ["Q".concat(question, ": ").concat(text)], false).join('\n') })];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    accept = function (question) { return __awaiter(void 0, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (isSingle) {
                                        return [2 /*return*/, send('yes')];
                                    }
                                    return [4 /*yield*/, (0, claude_code_1.update)($, round, function (r) { return (r === null ? r : __assign(__assign({}, r), { accepted: __spreadArray(__spreadArray([], r.accepted.filter(function (n) { return n !== question; }), true), [question], false) })); })];
                                case 1:
                                    _a.sent();
                                    return [4 /*yield*/, answer(question, 'yes')];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    change = function (question) { return __awaiter(void 0, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, (0, claude_code_1.update)($, round, function (r) { return (r === null ? r : __assign(__assign({}, r), { accepted: r.accepted.filter(function (n) { return n !== question; }) })); })];
                                case 1:
                                    _a.sent();
                                    return [4 /*yield*/, answer(question, '')];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    return [2 /*return*/, (<Box flexDirection="column" gap={1}>
        {parts.map(function (piece, index) {
                                return piece.kind === 'text' ? (<Box key={"text-".concat(index)}>{drawn[index]}</Box>) : (<Box key={"row-".concat(piece.question)} gap={1} alignItems="center" flexWrap="wrap">
              <Button key={"accept-".concat(piece.question)} label={"".concat(current.accepted.includes(piece.question) ? '✓' : '➡️', " ").concat(piece.text)} onPress={function () { return accept(piece.question); }}/>
              <Button key={"change-".concat(piece.question)} label="Change" dimColor onPress={function () { return change(piece.question); }}/>
            </Box>);
                            })}
        {isSingle ? null : <Button key="accept-all" variant="primary" label="Yes to all" onPress={function () { return send('yes to all'); }}/>}
      </Box>)];
            }
        });
    }); });
};
exports.register = register;
