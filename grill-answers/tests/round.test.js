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
Object.defineProperty(exports, "__esModule", { value: true });
var testing_1 = require("claude-code/testing");
var ROUND = "Here's a round about the labels.\n\n\u2753 **Q1** - **Accept button wording**: Should it keep the label \"Yes to all\"?\n\n\u27A1\uFE0F Yes: keep **\"Yes to all\"**, so the label says what you're sending.\n\n\u2753 **Q2** - **Per-question button wording**: Should each button say `Change Q2`?\n\n\u27A1\uFE0F Yes: keep \"Change Q2\".";
var SINGLE = "\u2753 **Q1** - **Single question**: Should it say \"Yes\"?\n\n\u27A1\uFE0F Yes.";
var block = function (text) { return ({ plugin: 'grill-answers', component: 'AssistantMessage', props: { text: text, isFirstOfReply: true } }); };
// What sits beneath the plugin: the engine's own drawing of a reply block, its turn end and its prompt box.
var engine = function (on) {
    var sent = [];
    var box = { text: '', cursor: 0 };
    on('ui.render', { component: 'AssistantMessage' }, function ($, e) { return h($.ui.resolve(e).Text, {}, e.props.text); });
    on('turn.complete', function ($, e) { return ({ text: e.answer }); });
    on('prompt.submit', function ($, e) {
        sent.push(e.text);
        return { text: e.text };
    });
    on('prompt.read', function () { return ({ value: __assign({}, box) }); });
    on('prompt.fill', function ($, e) {
        box.text = e.mode === 'append' ? box.text + e.text : e.text;
        box.cursor = box.text.length;
        return __assign({ isFilled: true }, box);
    });
    return { sent: sent, box: box };
};
var answered = function ($, answer) {
    return $.turn.complete({ answer: answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' });
};
(0, testing_1.describe)('answering a grill round from inside the text', function () {
    var _loop_1 = function (surface) {
        (0, testing_1.test)("each recommendation is a button where it stands, the text around it kept (".concat(surface, ")"), function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
            var _a, sent, box, ui, _b, _c, _d, _e, _f;
            var _g, _h;
            return __generator(this, function (_j) {
                switch (_j.label) {
                    case 0:
                        _a = engine(on), sent = _a.sent, box = _a.box;
                        return [4 /*yield*/, answered($, ROUND)];
                    case 1:
                        _j.sent();
                        return [4 /*yield*/, $.ui.mount(__assign(__assign({}, block(ROUND)), { surface: surface }))];
                    case 2:
                        ui = _j.sent();
                        _b = testing_1.expect;
                        return [4 /*yield*/, ui.find({ key: 'accept-1' })];
                    case 3:
                        _b.apply(void 0, [(_g = (_j.sent())) === null || _g === void 0 ? void 0 : _g.props.label]).toBe('➡️ Yes: keep "Yes to all", so the label says what you\'re sending.');
                        // The text around the buttons is the engine's own drawing, the recommendation lines cut out of it.
                        _c = testing_1.expect;
                        return [4 /*yield*/, ui.find({ type: 'Text', text: /Should each button say `Change Q2`/ })];
                    case 4:
                        // The text around the buttons is the engine's own drawing, the recommendation lines cut out of it.
                        _c.apply(void 0, [_j.sent()]).toBeDefined();
                        _d = testing_1.expect;
                        return [4 /*yield*/, ui.find({ type: 'Text', text: /➡️/ })];
                    case 5:
                        _d.apply(void 0, [_j.sent()]).toBeUndefined();
                        return [4 /*yield*/, ui.press({ key: 'accept-2' })];
                    case 6:
                        _j.sent();
                        return [4 /*yield*/, ui.press({ key: 'change-1' })];
                    case 7:
                        _j.sent();
                        (0, testing_1.expect)(box.text).toBe('Q2: yes\nQ1: ');
                        _e = testing_1.expect;
                        return [4 /*yield*/, ui.find({ key: 'accept-2' })];
                    case 8:
                        _e.apply(void 0, [(_h = (_j.sent())) === null || _h === void 0 ? void 0 : _h.props.label]).toBe('✓ Yes: keep "Change Q2".');
                        (0, testing_1.expect)(sent).toEqual([]);
                        return [4 /*yield*/, ui.press({ key: 'accept-all' })];
                    case 9:
                        _j.sent();
                        (0, testing_1.expect)(sent).toEqual(['yes to all']);
                        return [4 /*yield*/, ui.redraw()];
                    case 10:
                        _j.sent();
                        _f = testing_1.expect;
                        return [4 /*yield*/, ui.find({ key: 'accept-1' })];
                    case 11:
                        _f.apply(void 0, [_j.sent()]).toBeUndefined();
                        return [4 /*yield*/, ui.unmount()];
                    case 12:
                        _j.sent();
                        return [2 /*return*/];
                }
            });
        }); });
    };
    for (var _i = 0, _a = ['terminal', 'desktop']; _i < _a.length; _i++) {
        var surface = _a[_i];
        _loop_1(surface);
    }
    (0, testing_1.test)('a single question sends its answer from the recommendation itself', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var sent, ui, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    sent = engine(on).sent;
                    return [4 /*yield*/, answered($, SINGLE)];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, $.ui.mount(__assign(__assign({}, block(SINGLE)), { surface: 'desktop' }))];
                case 2:
                    ui = _b.sent();
                    _a = testing_1.expect;
                    return [4 /*yield*/, ui.find({ key: 'accept-all' })];
                case 3:
                    _a.apply(void 0, [_b.sent()]).toBeUndefined();
                    return [4 /*yield*/, ui.press({ key: 'accept-1' })];
                case 4:
                    _b.sent();
                    (0, testing_1.expect)(sent).toEqual(['yes']);
                    return [4 /*yield*/, ui.unmount()];
                case 5:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('a reply that is not a round, and a round already answered, stay plain text', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var plainReply, _a, old, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    engine(on);
                    return [4 /*yield*/, answered($, 'Pushed: the marketplace now lists only the ticket board.')];
                case 1:
                    _d.sent();
                    return [4 /*yield*/, $.ui.mount(__assign(__assign({}, block('Pushed: the marketplace now lists only the ticket board.')), { surface: 'terminal' }))];
                case 2:
                    plainReply = _d.sent();
                    _a = testing_1.expect;
                    return [4 /*yield*/, plainReply.find({ type: 'Button' })];
                case 3:
                    _a.apply(void 0, [_d.sent()]).toBeUndefined();
                    return [4 /*yield*/, plainReply.unmount()];
                case 4:
                    _d.sent();
                    return [4 /*yield*/, answered($, ROUND)];
                case 5:
                    _d.sent();
                    return [4 /*yield*/, $.prompt.submit({ text: 'Q2 no, use the titles', origin: { kind: 'composer' }, wait: false })];
                case 6:
                    _d.sent();
                    return [4 /*yield*/, $.ui.mount(__assign(__assign({}, block(ROUND)), { surface: 'terminal' }))];
                case 7:
                    old = _d.sent();
                    _b = testing_1.expect;
                    return [4 /*yield*/, old.find({ type: 'Button' })];
                case 8:
                    _b.apply(void 0, [_d.sent()]).toBeUndefined();
                    _c = testing_1.expect;
                    return [4 /*yield*/, old.find({ type: 'Text', text: /➡️ Yes: keep "Change Q2"/ })];
                case 9:
                    _c.apply(void 0, [_d.sent()]).toBeDefined();
                    return [4 /*yield*/, old.unmount()];
                case 10:
                    _d.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
