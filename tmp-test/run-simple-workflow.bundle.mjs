var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS({
  "node_modules/ajv/dist/compile/codegen/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = void 0;
    var _CodeOrName = class {
    };
    exports._CodeOrName = _CodeOrName;
    exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    var Name = class extends _CodeOrName {
      constructor(s) {
        super();
        if (!exports.IDENTIFIER.test(s))
          throw new Error("CodeGen: name must be a valid identifier");
        this.str = s;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        return false;
      }
      get names() {
        return { [this.str]: 1 };
      }
    };
    exports.Name = Name;
    var _Code = class extends _CodeOrName {
      constructor(code) {
        super();
        this._items = typeof code === "string" ? [code] : code;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        if (this._items.length > 1)
          return false;
        const item = this._items[0];
        return item === "" || item === '""';
      }
      get str() {
        var _a;
        return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
      }
      get names() {
        var _a;
        return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
          if (c instanceof Name)
            names[c.str] = (names[c.str] || 0) + 1;
          return names;
        }, {});
      }
    };
    exports._Code = _Code;
    exports.nil = new _Code("");
    function _(strs, ...args) {
      const code = [strs[0]];
      let i = 0;
      while (i < args.length) {
        addCodeArg(code, args[i]);
        code.push(strs[++i]);
      }
      return new _Code(code);
    }
    exports._ = _;
    var plus = new _Code("+");
    function str(strs, ...args) {
      const expr = [safeStringify(strs[0])];
      let i = 0;
      while (i < args.length) {
        expr.push(plus);
        addCodeArg(expr, args[i]);
        expr.push(plus, safeStringify(strs[++i]));
      }
      optimize(expr);
      return new _Code(expr);
    }
    exports.str = str;
    function addCodeArg(code, arg) {
      if (arg instanceof _Code)
        code.push(...arg._items);
      else if (arg instanceof Name)
        code.push(arg);
      else
        code.push(interpolate(arg));
    }
    exports.addCodeArg = addCodeArg;
    function optimize(expr) {
      let i = 1;
      while (i < expr.length - 1) {
        if (expr[i] === plus) {
          const res = mergeExprItems(expr[i - 1], expr[i + 1]);
          if (res !== void 0) {
            expr.splice(i - 1, 3, res);
            continue;
          }
          expr[i++] = "+";
        }
        i++;
      }
    }
    function mergeExprItems(a, b) {
      if (b === '""')
        return a;
      if (a === '""')
        return b;
      if (typeof a == "string") {
        if (b instanceof Name || a[a.length - 1] !== '"')
          return;
        if (typeof b != "string")
          return `${a.slice(0, -1)}${b}"`;
        if (b[0] === '"')
          return a.slice(0, -1) + b.slice(1);
        return;
      }
      if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
        return `"${a}${b.slice(1)}`;
      return;
    }
    function strConcat(c1, c2) {
      return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
    }
    exports.strConcat = strConcat;
    function interpolate(x) {
      return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
    }
    function stringify(x) {
      return new _Code(safeStringify(x));
    }
    exports.stringify = stringify;
    function safeStringify(x) {
      return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    exports.safeStringify = safeStringify;
    function getProperty(key) {
      return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
    }
    exports.getProperty = getProperty;
    function getEsmExportName(key) {
      if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
        return new _Code(`${key}`);
      }
      throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
    }
    exports.getEsmExportName = getEsmExportName;
    function regexpCode(rx) {
      return new _Code(rx.toString());
    }
    exports.regexpCode = regexpCode;
  }
});

// node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS({
  "node_modules/ajv/dist/compile/codegen/scope.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = void 0;
    var code_1 = require_code();
    var ValueError = class extends Error {
      constructor(name) {
        super(`CodeGen: "code" for ${name} not defined`);
        this.value = name.value;
      }
    };
    var UsedValueState;
    (function(UsedValueState2) {
      UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
      UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
    })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
    exports.varKinds = {
      const: new code_1.Name("const"),
      let: new code_1.Name("let"),
      var: new code_1.Name("var")
    };
    var Scope = class {
      constructor({ prefixes, parent } = {}) {
        this._names = {};
        this._prefixes = prefixes;
        this._parent = parent;
      }
      toName(nameOrPrefix) {
        return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
      }
      name(prefix) {
        return new code_1.Name(this._newName(prefix));
      }
      _newName(prefix) {
        const ng = this._names[prefix] || this._nameGroup(prefix);
        return `${prefix}${ng.index++}`;
      }
      _nameGroup(prefix) {
        var _a, _b;
        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
          throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
        }
        return this._names[prefix] = { prefix, index: 0 };
      }
    };
    exports.Scope = Scope;
    var ValueScopeName = class extends code_1.Name {
      constructor(prefix, nameStr) {
        super(nameStr);
        this.prefix = prefix;
      }
      setValue(value, { property, itemIndex }) {
        this.value = value;
        this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
      }
    };
    exports.ValueScopeName = ValueScopeName;
    var line = (0, code_1._)`\n`;
    var ValueScope = class extends Scope {
      constructor(opts) {
        super(opts);
        this._values = {};
        this._scope = opts.scope;
        this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
      }
      get() {
        return this._scope;
      }
      name(prefix) {
        return new ValueScopeName(prefix, this._newName(prefix));
      }
      value(nameOrPrefix, value) {
        var _a;
        if (value.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const name = this.toName(nameOrPrefix);
        const { prefix } = name;
        const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
        let vs = this._values[prefix];
        if (vs) {
          const _name = vs.get(valueKey);
          if (_name)
            return _name;
        } else {
          vs = this._values[prefix] = /* @__PURE__ */ new Map();
        }
        vs.set(valueKey, name);
        const s = this._scope[prefix] || (this._scope[prefix] = []);
        const itemIndex = s.length;
        s[itemIndex] = value.ref;
        name.setValue(value, { property: prefix, itemIndex });
        return name;
      }
      getValue(prefix, keyOrRef) {
        const vs = this._values[prefix];
        if (!vs)
          return;
        return vs.get(keyOrRef);
      }
      scopeRefs(scopeName, values = this._values) {
        return this._reduceValues(values, (name) => {
          if (name.scopePath === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return (0, code_1._)`${scopeName}${name.scopePath}`;
        });
      }
      scopeCode(values = this._values, usedValues, getCode) {
        return this._reduceValues(values, (name) => {
          if (name.value === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return name.value.code;
        }, usedValues, getCode);
      }
      _reduceValues(values, valueCode, usedValues = {}, getCode) {
        let code = code_1.nil;
        for (const prefix in values) {
          const vs = values[prefix];
          if (!vs)
            continue;
          const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
          vs.forEach((name) => {
            if (nameSet.has(name))
              return;
            nameSet.set(name, UsedValueState.Started);
            let c = valueCode(name);
            if (c) {
              const def2 = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
              code = (0, code_1._)`${code}${def2} ${name} = ${c};${this.opts._n}`;
            } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
              code = (0, code_1._)`${code}${c}${this.opts._n}`;
            } else {
              throw new ValueError(name);
            }
            nameSet.set(name, UsedValueState.Completed);
          });
        }
        return code;
      }
    };
    exports.ValueScope = ValueScope;
  }
});

// node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS({
  "node_modules/ajv/dist/compile/codegen/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = void 0;
    var code_1 = require_code();
    var scope_1 = require_scope();
    var code_2 = require_code();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return code_2._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return code_2.str;
    } });
    Object.defineProperty(exports, "strConcat", { enumerable: true, get: function() {
      return code_2.strConcat;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return code_2.nil;
    } });
    Object.defineProperty(exports, "getProperty", { enumerable: true, get: function() {
      return code_2.getProperty;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return code_2.stringify;
    } });
    Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function() {
      return code_2.regexpCode;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return code_2.Name;
    } });
    var scope_2 = require_scope();
    Object.defineProperty(exports, "Scope", { enumerable: true, get: function() {
      return scope_2.Scope;
    } });
    Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function() {
      return scope_2.ValueScope;
    } });
    Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function() {
      return scope_2.ValueScopeName;
    } });
    Object.defineProperty(exports, "varKinds", { enumerable: true, get: function() {
      return scope_2.varKinds;
    } });
    exports.operators = {
      GT: new code_1._Code(">"),
      GTE: new code_1._Code(">="),
      LT: new code_1._Code("<"),
      LTE: new code_1._Code("<="),
      EQ: new code_1._Code("==="),
      NEQ: new code_1._Code("!=="),
      NOT: new code_1._Code("!"),
      OR: new code_1._Code("||"),
      AND: new code_1._Code("&&"),
      ADD: new code_1._Code("+")
    };
    var Node = class {
      optimizeNodes() {
        return this;
      }
      optimizeNames(_names, _constants) {
        return this;
      }
    };
    var Def = class extends Node {
      constructor(varKind, name, rhs) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.rhs = rhs;
      }
      render({ es5, _n }) {
        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
        const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${varKind} ${this.name}${rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (!names[this.name.str])
          return;
        if (this.rhs)
          this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
      }
    };
    var Assign = class extends Node {
      constructor(lhs, rhs, sideEffects) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
        this.sideEffects = sideEffects;
      }
      render({ _n }) {
        return `${this.lhs} = ${this.rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
          return;
        this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
        return addExprNames(names, this.rhs);
      }
    };
    var AssignOp = class extends Assign {
      constructor(lhs, op, rhs, sideEffects) {
        super(lhs, rhs, sideEffects);
        this.op = op;
      }
      render({ _n }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
      }
    };
    var Label = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        return `${this.label}:` + _n;
      }
    };
    var Break = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        const label = this.label ? ` ${this.label}` : "";
        return `break${label};` + _n;
      }
    };
    var Throw = class extends Node {
      constructor(error) {
        super();
        this.error = error;
      }
      render({ _n }) {
        return `throw ${this.error};` + _n;
      }
      get names() {
        return this.error.names;
      }
    };
    var AnyCode = class extends Node {
      constructor(code) {
        super();
        this.code = code;
      }
      render({ _n }) {
        return `${this.code};` + _n;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(names, constants) {
        this.code = optimizeExpr(this.code, names, constants);
        return this;
      }
      get names() {
        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
      }
    };
    var ParentNode = class extends Node {
      constructor(nodes = []) {
        super();
        this.nodes = nodes;
      }
      render(opts) {
        return this.nodes.reduce((code, n) => code + n.render(opts), "");
      }
      optimizeNodes() {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i].optimizeNodes();
          if (Array.isArray(n))
            nodes.splice(i, 1, ...n);
          else if (n)
            nodes[i] = n;
          else
            nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      optimizeNames(names, constants) {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i];
          if (n.optimizeNames(names, constants))
            continue;
          subtractNames(names, n.names);
          nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
      }
    };
    var BlockNode = class extends ParentNode {
      render(opts) {
        return "{" + opts._n + super.render(opts) + "}" + opts._n;
      }
    };
    var Root = class extends ParentNode {
    };
    var Else = class extends BlockNode {
    };
    Else.kind = "else";
    var If = class _If extends BlockNode {
      constructor(condition, nodes) {
        super(nodes);
        this.condition = condition;
      }
      render(opts) {
        let code = `if(${this.condition})` + super.render(opts);
        if (this.else)
          code += "else " + this.else.render(opts);
        return code;
      }
      optimizeNodes() {
        super.optimizeNodes();
        const cond = this.condition;
        if (cond === true)
          return this.nodes;
        let e = this.else;
        if (e) {
          const ns = e.optimizeNodes();
          e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
        }
        if (e) {
          if (cond === false)
            return e instanceof _If ? e : e.nodes;
          if (this.nodes.length)
            return this;
          return new _If(not(cond), e instanceof _If ? [e] : e.nodes);
        }
        if (cond === false || !this.nodes.length)
          return void 0;
        return this;
      }
      optimizeNames(names, constants) {
        var _a;
        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        if (!(super.optimizeNames(names, constants) || this.else))
          return;
        this.condition = optimizeExpr(this.condition, names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        addExprNames(names, this.condition);
        if (this.else)
          addNames(names, this.else.names);
        return names;
      }
    };
    If.kind = "if";
    var For = class extends BlockNode {
    };
    For.kind = "for";
    var ForLoop = class extends For {
      constructor(iteration) {
        super();
        this.iteration = iteration;
      }
      render(opts) {
        return `for(${this.iteration})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iteration = optimizeExpr(this.iteration, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iteration.names);
      }
    };
    var ForRange = class extends For {
      constructor(varKind, name, from, to) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.from = from;
        this.to = to;
      }
      render(opts) {
        const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
        const { name, from, to } = this;
        return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
      }
      get names() {
        const names = addExprNames(super.names, this.from);
        return addExprNames(names, this.to);
      }
    };
    var ForIter = class extends For {
      constructor(loop, varKind, name, iterable) {
        super();
        this.loop = loop;
        this.varKind = varKind;
        this.name = name;
        this.iterable = iterable;
      }
      render(opts) {
        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iterable = optimizeExpr(this.iterable, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iterable.names);
      }
    };
    var Func = class extends BlockNode {
      constructor(name, args, async) {
        super();
        this.name = name;
        this.args = args;
        this.async = async;
      }
      render(opts) {
        const _async = this.async ? "async " : "";
        return `${_async}function ${this.name}(${this.args})` + super.render(opts);
      }
    };
    Func.kind = "func";
    var Return = class extends ParentNode {
      render(opts) {
        return "return " + super.render(opts);
      }
    };
    Return.kind = "return";
    var Try = class extends BlockNode {
      render(opts) {
        let code = "try" + super.render(opts);
        if (this.catch)
          code += this.catch.render(opts);
        if (this.finally)
          code += this.finally.render(opts);
        return code;
      }
      optimizeNodes() {
        var _a, _b;
        super.optimizeNodes();
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
        return this;
      }
      optimizeNames(names, constants) {
        var _a, _b;
        super.optimizeNames(names, constants);
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        if (this.catch)
          addNames(names, this.catch.names);
        if (this.finally)
          addNames(names, this.finally.names);
        return names;
      }
    };
    var Catch = class extends BlockNode {
      constructor(error) {
        super();
        this.error = error;
      }
      render(opts) {
        return `catch(${this.error})` + super.render(opts);
      }
    };
    Catch.kind = "catch";
    var Finally = class extends BlockNode {
      render(opts) {
        return "finally" + super.render(opts);
      }
    };
    Finally.kind = "finally";
    var CodeGen = class {
      constructor(extScope, opts = {}) {
        this._values = {};
        this._blockStarts = [];
        this._constants = {};
        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
        this._extScope = extScope;
        this._scope = new scope_1.Scope({ parent: extScope });
        this._nodes = [new Root()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(prefix) {
        return this._scope.name(prefix);
      }
      // reserves unique name in the external scope
      scopeName(prefix) {
        return this._extScope.name(prefix);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(prefixOrName, value) {
        const name = this._extScope.value(prefixOrName, value);
        const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
        vs.add(name);
        return name;
      }
      getScopeValue(prefix, keyOrRef) {
        return this._extScope.getValue(prefix, keyOrRef);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(scopeName) {
        return this._extScope.scopeRefs(scopeName, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(varKind, nameOrPrefix, rhs, constant) {
        const name = this._scope.toName(nameOrPrefix);
        if (rhs !== void 0 && constant)
          this._constants[name.str] = rhs;
        this._leafNode(new Def(varKind, name, rhs));
        return name;
      }
      // `const` declaration (`var` in es5 mode)
      const(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
      }
      // `var` declaration with optional assignment
      var(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
      }
      // assignment code
      assign(lhs, rhs, sideEffects) {
        return this._leafNode(new Assign(lhs, rhs, sideEffects));
      }
      // `+=` code
      add(lhs, rhs) {
        return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
      }
      // appends passed SafeExpr to code or executes Block
      code(c) {
        if (typeof c == "function")
          c();
        else if (c !== code_1.nil)
          this._leafNode(new AnyCode(c));
        return this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
      object(...keyValues) {
        const code = ["{"];
        for (const [key, value] of keyValues) {
          if (code.length > 1)
            code.push(",");
          code.push(key);
          if (key !== value || this.opts.es5) {
            code.push(":");
            (0, code_1.addCodeArg)(code, value);
          }
        }
        code.push("}");
        return new code_1._Code(code);
      }
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
      if(condition, thenBody, elseBody) {
        this._blockNode(new If(condition));
        if (thenBody && elseBody) {
          this.code(thenBody).else().code(elseBody).endIf();
        } else if (thenBody) {
          this.code(thenBody).endIf();
        } else if (elseBody) {
          throw new Error('CodeGen: "else" body without "then" body');
        }
        return this;
      }
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(condition) {
        return this._elseNode(new If(condition));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new Else());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(If, Else);
      }
      _for(node, forBody) {
        this._blockNode(node);
        if (forBody)
          this.code(forBody).endFor();
        return this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(iteration, forBody) {
        return this._for(new ForLoop(iteration), forBody);
      }
      // `for` statement for a range of values
      forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
      forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
        const name = this._scope.toName(nameOrPrefix);
        if (this.opts.es5) {
          const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
          return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
            this.var(name, (0, code_1._)`${arr}[${i}]`);
            forBody(name);
          });
        }
        return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
      }
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
        if (this.opts.ownProperties) {
          return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
        }
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(For);
      }
      // `label` statement
      label(label) {
        return this._leafNode(new Label(label));
      }
      // `break` statement
      break(label) {
        return this._leafNode(new Break(label));
      }
      // `return` statement
      return(value) {
        const node = new Return();
        this._blockNode(node);
        this.code(value);
        if (node.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(Return);
      }
      // `try` statement
      try(tryBody, catchCode, finallyCode) {
        if (!catchCode && !finallyCode)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const node = new Try();
        this._blockNode(node);
        this.code(tryBody);
        if (catchCode) {
          const error = this.name("e");
          this._currNode = node.catch = new Catch(error);
          catchCode(error);
        }
        if (finallyCode) {
          this._currNode = node.finally = new Finally();
          this.code(finallyCode);
        }
        return this._endBlockNode(Catch, Finally);
      }
      // `throw` statement
      throw(error) {
        return this._leafNode(new Throw(error));
      }
      // start self-balancing block
      block(body, nodeCount) {
        this._blockStarts.push(this._nodes.length);
        if (body)
          this.code(body).endBlock(nodeCount);
        return this;
      }
      // end the current self-balancing block
      endBlock(nodeCount) {
        const len = this._blockStarts.pop();
        if (len === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const toClose = this._nodes.length - len;
        if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
          throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
        }
        this._nodes.length = len;
        return this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(name, args = code_1.nil, async, funcBody) {
        this._blockNode(new Func(name, args, async));
        if (funcBody)
          this.code(funcBody).endFunc();
        return this;
      }
      // end function definition
      endFunc() {
        return this._endBlockNode(Func);
      }
      optimize(n = 1) {
        while (n-- > 0) {
          this._root.optimizeNodes();
          this._root.optimizeNames(this._root.names, this._constants);
        }
      }
      _leafNode(node) {
        this._currNode.nodes.push(node);
        return this;
      }
      _blockNode(node) {
        this._currNode.nodes.push(node);
        this._nodes.push(node);
      }
      _endBlockNode(N1, N2) {
        const n = this._currNode;
        if (n instanceof N1 || N2 && n instanceof N2) {
          this._nodes.pop();
          return this;
        }
        throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
      }
      _elseNode(node) {
        const n = this._currNode;
        if (!(n instanceof If)) {
          throw new Error('CodeGen: "else" without "if"');
        }
        this._currNode = n.else = node;
        return this;
      }
      get _root() {
        return this._nodes[0];
      }
      get _currNode() {
        const ns = this._nodes;
        return ns[ns.length - 1];
      }
      set _currNode(node) {
        const ns = this._nodes;
        ns[ns.length - 1] = node;
      }
    };
    exports.CodeGen = CodeGen;
    function addNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) + (from[n] || 0);
      return names;
    }
    function addExprNames(names, from) {
      return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
    }
    function optimizeExpr(expr, names, constants) {
      if (expr instanceof code_1.Name)
        return replaceName(expr);
      if (!canOptimize(expr))
        return expr;
      return new code_1._Code(expr._items.reduce((items, c) => {
        if (c instanceof code_1.Name)
          c = replaceName(c);
        if (c instanceof code_1._Code)
          items.push(...c._items);
        else
          items.push(c);
        return items;
      }, []));
      function replaceName(n) {
        const c = constants[n.str];
        if (c === void 0 || names[n.str] !== 1)
          return n;
        delete names[n.str];
        return c;
      }
      function canOptimize(e) {
        return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== void 0);
      }
    }
    function subtractNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) - (from[n] || 0);
    }
    function not(x) {
      return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
    }
    exports.not = not;
    var andCode = mappend(exports.operators.AND);
    function and(...args) {
      return args.reduce(andCode);
    }
    exports.and = and;
    var orCode = mappend(exports.operators.OR);
    function or(...args) {
      return args.reduce(orCode);
    }
    exports.or = or;
    function mappend(op) {
      return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
    }
    function par(x) {
      return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
    }
  }
});

// node_modules/ajv/dist/compile/util.js
var require_util = __commonJS({
  "node_modules/ajv/dist/compile/util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = void 0;
    var codegen_1 = require_codegen();
    var code_1 = require_code();
    function toHash(arr) {
      const hash = {};
      for (const item of arr)
        hash[item] = true;
      return hash;
    }
    exports.toHash = toHash;
    function alwaysValidSchema(it, schema) {
      if (typeof schema == "boolean")
        return schema;
      if (Object.keys(schema).length === 0)
        return true;
      checkUnknownRules(it, schema);
      return !schemaHasRules(schema, it.self.RULES.all);
    }
    exports.alwaysValidSchema = alwaysValidSchema;
    function checkUnknownRules(it, schema = it.schema) {
      const { opts, self: self2 } = it;
      if (!opts.strictSchema)
        return;
      if (typeof schema === "boolean")
        return;
      const rules = self2.RULES.keywords;
      for (const key in schema) {
        if (!rules[key])
          checkStrictMode(it, `unknown keyword: "${key}"`);
      }
    }
    exports.checkUnknownRules = checkUnknownRules;
    function schemaHasRules(schema, rules) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (rules[key])
          return true;
      return false;
    }
    exports.schemaHasRules = schemaHasRules;
    function schemaHasRulesButRef(schema, RULES) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
          return true;
      return false;
    }
    exports.schemaHasRulesButRef = schemaHasRulesButRef;
    function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
      if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
          return schema;
        if (typeof schema == "string")
          return (0, codegen_1._)`${schema}`;
      }
      return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
    }
    exports.schemaRefOrVal = schemaRefOrVal;
    function unescapeFragment(str) {
      return unescapeJsonPointer(decodeURIComponent(str));
    }
    exports.unescapeFragment = unescapeFragment;
    function escapeFragment(str) {
      return encodeURIComponent(escapeJsonPointer(str));
    }
    exports.escapeFragment = escapeFragment;
    function escapeJsonPointer(str) {
      if (typeof str == "number")
        return `${str}`;
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    exports.escapeJsonPointer = escapeJsonPointer;
    function unescapeJsonPointer(str) {
      return str.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    exports.unescapeJsonPointer = unescapeJsonPointer;
    function eachItem(xs, f) {
      if (Array.isArray(xs)) {
        for (const x of xs)
          f(x);
      } else {
        f(xs);
      }
    }
    exports.eachItem = eachItem;
    function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
      return (gen, from, to, toName) => {
        const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
        return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
      };
    }
    exports.mergeEvaluated = {
      props: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
          gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
        }),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
          if (from === true) {
            gen.assign(to, true);
          } else {
            gen.assign(to, (0, codegen_1._)`${to} || {}`);
            setEvaluated(gen, to, from);
          }
        }),
        mergeValues: (from, to) => from === true ? true : { ...from, ...to },
        resultToName: evaluatedPropsToName
      }),
      items: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
        mergeValues: (from, to) => from === true ? true : Math.max(from, to),
        resultToName: (gen, items) => gen.var("items", items)
      })
    };
    function evaluatedPropsToName(gen, ps) {
      if (ps === true)
        return gen.var("props", true);
      const props = gen.var("props", (0, codegen_1._)`{}`);
      if (ps !== void 0)
        setEvaluated(gen, props, ps);
      return props;
    }
    exports.evaluatedPropsToName = evaluatedPropsToName;
    function setEvaluated(gen, props, ps) {
      Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
    }
    exports.setEvaluated = setEvaluated;
    var snippets = {};
    function useFunc(gen, f) {
      return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
      });
    }
    exports.useFunc = useFunc;
    var Type;
    (function(Type2) {
      Type2[Type2["Num"] = 0] = "Num";
      Type2[Type2["Str"] = 1] = "Str";
    })(Type || (exports.Type = Type = {}));
    function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
      if (dataProp instanceof codegen_1.Name) {
        const isNumber = dataPropType === Type.Num;
        return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
      }
      return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
    }
    exports.getErrorPath = getErrorPath;
    function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
      if (!mode)
        return;
      msg = `strict mode: ${msg}`;
      if (mode === true)
        throw new Error(msg);
      it.self.logger.warn(msg);
    }
    exports.checkStrictMode = checkStrictMode;
  }
});

// node_modules/ajv/dist/compile/names.js
var require_names = __commonJS({
  "node_modules/ajv/dist/compile/names.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var names = {
      // validation function arguments
      data: new codegen_1.Name("data"),
      // data passed to validation function
      // args passed from referencing schema
      valCxt: new codegen_1.Name("valCxt"),
      // validation/data context - should not be used directly, it is destructured to the names below
      instancePath: new codegen_1.Name("instancePath"),
      parentData: new codegen_1.Name("parentData"),
      parentDataProperty: new codegen_1.Name("parentDataProperty"),
      rootData: new codegen_1.Name("rootData"),
      // root data - same as the data passed to the first/top validation function
      dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
      // used to support recursiveRef and dynamicRef
      // function scoped variables
      vErrors: new codegen_1.Name("vErrors"),
      // null or array of validation errors
      errors: new codegen_1.Name("errors"),
      // counter of validation errors
      this: new codegen_1.Name("this"),
      // "globals"
      self: new codegen_1.Name("self"),
      scope: new codegen_1.Name("scope"),
      // JTD serialize/parse name for JSON string and position
      json: new codegen_1.Name("json"),
      jsonPos: new codegen_1.Name("jsonPos"),
      jsonLen: new codegen_1.Name("jsonLen"),
      jsonPart: new codegen_1.Name("jsonPart")
    };
    exports.default = names;
  }
});

// node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS({
  "node_modules/ajv/dist/compile/errors.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    exports.keywordError = {
      message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
    };
    exports.keyword$DataError = {
      message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
    };
    function reportError(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
        addError(gen, errObj);
      } else {
        returnErrors(it, (0, codegen_1._)`[${errObj}]`);
      }
    }
    exports.reportError = reportError;
    function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      addError(gen, errObj);
      if (!(compositeRule || allErrors)) {
        returnErrors(it, names_1.default.vErrors);
      }
    }
    exports.reportExtraError = reportExtraError;
    function resetErrorsCount(gen, errsCount) {
      gen.assign(names_1.default.errors, errsCount);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
    }
    exports.resetErrorsCount = resetErrorsCount;
    function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
      if (errsCount === void 0)
        throw new Error("ajv implementation error");
      const err = gen.name("err");
      gen.forRange("i", errsCount, names_1.default.errors, (i) => {
        gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
        gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
        gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
        if (it.opts.verbose) {
          gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
          gen.assign((0, codegen_1._)`${err}.data`, data);
        }
      });
    }
    exports.extendErrors = extendErrors;
    function addError(gen, errObj) {
      const err = gen.const("err", errObj);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
      gen.code((0, codegen_1._)`${names_1.default.errors}++`);
    }
    function returnErrors(it, errs) {
      const { gen, validateName, schemaEnv } = it;
      if (schemaEnv.$async) {
        gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
        gen.return(false);
      }
    }
    var E = {
      keyword: new codegen_1.Name("keyword"),
      schemaPath: new codegen_1.Name("schemaPath"),
      // also used in JTD errors
      params: new codegen_1.Name("params"),
      propertyName: new codegen_1.Name("propertyName"),
      message: new codegen_1.Name("message"),
      schema: new codegen_1.Name("schema"),
      parentSchema: new codegen_1.Name("parentSchema")
    };
    function errorObjectCode(cxt, error, errorPaths) {
      const { createErrors } = cxt.it;
      if (createErrors === false)
        return (0, codegen_1._)`{}`;
      return errorObject(cxt, error, errorPaths);
    }
    function errorObject(cxt, error, errorPaths = {}) {
      const { gen, it } = cxt;
      const keyValues = [
        errorInstancePath(it, errorPaths),
        errorSchemaPath(cxt, errorPaths)
      ];
      extraErrorProps(cxt, error, keyValues);
      return gen.object(...keyValues);
    }
    function errorInstancePath({ errorPath }, { instancePath }) {
      const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
      return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
    }
    function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
      let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
      if (schemaPath) {
        schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
      }
      return [E.schemaPath, schPath];
    }
    function extraErrorProps(cxt, { params, message }, keyValues) {
      const { keyword, data, schemaValue, it } = cxt;
      const { opts, propertyName, topSchemaRef, schemaPath } = it;
      keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
      if (opts.messages) {
        keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
      }
      if (opts.verbose) {
        keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
      }
      if (propertyName)
        keyValues.push([E.propertyName, propertyName]);
    }
  }
});

// node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS({
  "node_modules/ajv/dist/compile/validate/boolSchema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = void 0;
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var boolError = {
      message: "boolean schema is false"
    };
    function topBoolOrEmptySchema(it) {
      const { gen, schema, validateName } = it;
      if (schema === false) {
        falseSchemaError(it, false);
      } else if (typeof schema == "object" && schema.$async === true) {
        gen.return(names_1.default.data);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, null);
        gen.return(true);
      }
    }
    exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
    function boolOrEmptySchema(it, valid) {
      const { gen, schema } = it;
      if (schema === false) {
        gen.var(valid, false);
        falseSchemaError(it);
      } else {
        gen.var(valid, true);
      }
    }
    exports.boolOrEmptySchema = boolOrEmptySchema;
    function falseSchemaError(it, overrideAllErrors) {
      const { gen, data } = it;
      const cxt = {
        gen,
        keyword: "false schema",
        data,
        schema: false,
        schemaCode: false,
        schemaValue: false,
        params: {},
        it
      };
      (0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
    }
  }
});

// node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS({
  "node_modules/ajv/dist/compile/rules.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getRules = exports.isJSONType = void 0;
    var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
    var jsonTypes = new Set(_jsonTypes);
    function isJSONType(x) {
      return typeof x == "string" && jsonTypes.has(x);
    }
    exports.isJSONType = isJSONType;
    function getRules() {
      const groups = {
        number: { type: "number", rules: [] },
        string: { type: "string", rules: [] },
        array: { type: "array", rules: [] },
        object: { type: "object", rules: [] }
      };
      return {
        types: { ...groups, integer: true, boolean: true, null: true },
        rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
        post: { rules: [] },
        all: {},
        keywords: {}
      };
    }
    exports.getRules = getRules;
  }
});

// node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS({
  "node_modules/ajv/dist/compile/validate/applicability.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = void 0;
    function schemaHasRulesForType({ schema, self: self2 }, type) {
      const group = self2.RULES.types[type];
      return group && group !== true && shouldUseGroup(schema, group);
    }
    exports.schemaHasRulesForType = schemaHasRulesForType;
    function shouldUseGroup(schema, group) {
      return group.rules.some((rule) => shouldUseRule(schema, rule));
    }
    exports.shouldUseGroup = shouldUseGroup;
    function shouldUseRule(schema, rule) {
      var _a;
      return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
    }
    exports.shouldUseRule = shouldUseRule;
  }
});

// node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS({
  "node_modules/ajv/dist/compile/validate/dataType.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = void 0;
    var rules_1 = require_rules();
    var applicability_1 = require_applicability();
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var DataType;
    (function(DataType2) {
      DataType2[DataType2["Correct"] = 0] = "Correct";
      DataType2[DataType2["Wrong"] = 1] = "Wrong";
    })(DataType || (exports.DataType = DataType = {}));
    function getSchemaTypes(schema) {
      const types = getJSONTypes(schema.type);
      const hasNull = types.includes("null");
      if (hasNull) {
        if (schema.nullable === false)
          throw new Error("type: null contradicts nullable: false");
      } else {
        if (!types.length && schema.nullable !== void 0) {
          throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
          types.push("null");
      }
      return types;
    }
    exports.getSchemaTypes = getSchemaTypes;
    function getJSONTypes(ts) {
      const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
      if (types.every(rules_1.isJSONType))
        return types;
      throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
    }
    exports.getJSONTypes = getJSONTypes;
    function coerceAndCheckDataType(it, types) {
      const { gen, data, opts } = it;
      const coerceTo = coerceToTypes(types, opts.coerceTypes);
      const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
      if (checkTypes) {
        const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
        gen.if(wrongType, () => {
          if (coerceTo.length)
            coerceData(it, types, coerceTo);
          else
            reportTypeError(it);
        });
      }
      return checkTypes;
    }
    exports.coerceAndCheckDataType = coerceAndCheckDataType;
    var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
    function coerceToTypes(types, coerceTypes) {
      return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
    }
    function coerceData(it, types, coerceTo) {
      const { gen, data, opts } = it;
      const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
      const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
      if (opts.coerceTypes === "array") {
        gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
      }
      gen.if((0, codegen_1._)`${coerced} !== undefined`);
      for (const t of coerceTo) {
        if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
          coerceSpecificType(t);
        }
      }
      gen.else();
      reportTypeError(it);
      gen.endIf();
      gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
        gen.assign(data, coerced);
        assignParentData(it, coerced);
      });
      function coerceSpecificType(t) {
        switch (t) {
          case "string":
            gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
            return;
          case "number":
            gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "integer":
            gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "boolean":
            gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
            return;
          case "null":
            gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
            gen.assign(coerced, null);
            return;
          case "array":
            gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
        }
      }
    }
    function assignParentData({ gen, parentData, parentDataProperty }, expr) {
      gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
    }
    function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
      const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
      let cond;
      switch (dataType) {
        case "null":
          return (0, codegen_1._)`${data} ${EQ} null`;
        case "array":
          cond = (0, codegen_1._)`Array.isArray(${data})`;
          break;
        case "object":
          cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
          break;
        case "integer":
          cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
          break;
        case "number":
          cond = numCond();
          break;
        default:
          return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
      }
      return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
      function numCond(_cond = codegen_1.nil) {
        return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
      }
    }
    exports.checkDataType = checkDataType;
    function checkDataTypes(dataTypes, data, strictNums, correct) {
      if (dataTypes.length === 1) {
        return checkDataType(dataTypes[0], data, strictNums, correct);
      }
      let cond;
      const types = (0, util_1.toHash)(dataTypes);
      if (types.array && types.object) {
        const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
        cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
        delete types.null;
        delete types.array;
        delete types.object;
      } else {
        cond = codegen_1.nil;
      }
      if (types.number)
        delete types.integer;
      for (const t in types)
        cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
      return cond;
    }
    exports.checkDataTypes = checkDataTypes;
    var typeError = {
      message: ({ schema }) => `must be ${schema}`,
      params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
    };
    function reportTypeError(it) {
      const cxt = getTypeErrorContext(it);
      (0, errors_1.reportError)(cxt, typeError);
    }
    exports.reportTypeError = reportTypeError;
    function getTypeErrorContext(it) {
      const { gen, data, schema } = it;
      const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
      return {
        gen,
        keyword: "type",
        data,
        schema: schema.type,
        schemaCode,
        schemaValue: schemaCode,
        parentSchema: schema,
        params: {},
        it
      };
    }
  }
});

// node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS({
  "node_modules/ajv/dist/compile/validate/defaults.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.assignDefaults = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function assignDefaults(it, ty) {
      const { properties, items } = it.schema;
      if (ty === "object" && properties) {
        for (const key in properties) {
          assignDefault(it, key, properties[key].default);
        }
      } else if (ty === "array" && Array.isArray(items)) {
        items.forEach((sch, i) => assignDefault(it, i, sch.default));
      }
    }
    exports.assignDefaults = assignDefaults;
    function assignDefault(it, prop, defaultValue) {
      const { gen, compositeRule, data, opts } = it;
      if (defaultValue === void 0)
        return;
      const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
      if (compositeRule) {
        (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
        return;
      }
      let condition = (0, codegen_1._)`${childData} === undefined`;
      if (opts.useDefaults === "empty") {
        condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
      }
      gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
    }
  }
});

// node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    var util_2 = require_util();
    function checkReportMissingProp(cxt, prop) {
      const { gen, data, it } = cxt;
      gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
        cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
        cxt.error();
      });
    }
    exports.checkReportMissingProp = checkReportMissingProp;
    function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
      return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
    }
    exports.checkMissingProp = checkMissingProp;
    function reportMissingProp(cxt, missing) {
      cxt.setParams({ missingProperty: missing }, true);
      cxt.error();
    }
    exports.reportMissingProp = reportMissingProp;
    function hasPropFunc(gen) {
      return gen.scopeValue("func", {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ref: Object.prototype.hasOwnProperty,
        code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
      });
    }
    exports.hasPropFunc = hasPropFunc;
    function isOwnProperty(gen, data, property) {
      return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
    }
    exports.isOwnProperty = isOwnProperty;
    function propertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
      return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
    }
    exports.propertyInData = propertyInData;
    function noPropertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
      return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
    }
    exports.noPropertyInData = noPropertyInData;
    function allSchemaProperties(schemaMap) {
      return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
    }
    exports.allSchemaProperties = allSchemaProperties;
    function schemaProperties(it, schemaMap) {
      return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
    }
    exports.schemaProperties = schemaProperties;
    function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
      const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
      const valCxt = [
        [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
        [names_1.default.parentData, it.parentData],
        [names_1.default.parentDataProperty, it.parentDataProperty],
        [names_1.default.rootData, names_1.default.rootData]
      ];
      if (it.opts.dynamicRef)
        valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
      const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
      return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
    }
    exports.callValidateCode = callValidateCode;
    var newRegExp = (0, codegen_1._)`new RegExp`;
    function usePattern({ gen, it: { opts } }, pattern) {
      const u = opts.unicodeRegExp ? "u" : "";
      const { regExp } = opts.code;
      const rx = regExp(pattern, u);
      return gen.scopeValue("pattern", {
        key: rx.toString(),
        ref: rx,
        code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
      });
    }
    exports.usePattern = usePattern;
    function validateArray(cxt) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      if (it.allErrors) {
        const validArr = gen.let("valid", true);
        validateItems(() => gen.assign(validArr, false));
        return validArr;
      }
      gen.var(valid, true);
      validateItems(() => gen.break());
      return valid;
      function validateItems(notValid) {
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword,
            dataProp: i,
            dataPropType: util_1.Type.Num
          }, valid);
          gen.if((0, codegen_1.not)(valid), notValid);
        });
      }
    }
    exports.validateArray = validateArray;
    function validateUnion(cxt) {
      const { gen, schema, keyword, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
      if (alwaysValid && !it.opts.unevaluated)
        return;
      const valid = gen.let("valid", false);
      const schValid = gen.name("_valid");
      gen.block(() => schema.forEach((_sch, i) => {
        const schCxt = cxt.subschema({
          keyword,
          schemaProp: i,
          compositeRule: true
        }, schValid);
        gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
        const merged = cxt.mergeValidEvaluated(schCxt, schValid);
        if (!merged)
          gen.if((0, codegen_1.not)(valid));
      }));
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
    }
    exports.validateUnion = validateUnion;
  }
});

// node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS({
  "node_modules/ajv/dist/compile/validate/keyword.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = void 0;
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var code_1 = require_code2();
    var errors_1 = require_errors();
    function macroKeywordCode(cxt, def2) {
      const { gen, keyword, schema, parentSchema, it } = cxt;
      const macroSchema = def2.macro.call(it.self, schema, parentSchema, it);
      const schemaRef = useKeyword(gen, keyword, macroSchema);
      if (it.opts.validateSchema !== false)
        it.self.validateSchema(macroSchema, true);
      const valid = gen.name("valid");
      cxt.subschema({
        schema: macroSchema,
        schemaPath: codegen_1.nil,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`,
        topSchemaRef: schemaRef,
        compositeRule: true
      }, valid);
      cxt.pass(valid, () => cxt.error(true));
    }
    exports.macroKeywordCode = macroKeywordCode;
    function funcKeywordCode(cxt, def2) {
      var _a;
      const { gen, keyword, schema, parentSchema, $data, it } = cxt;
      checkAsyncKeyword(it, def2);
      const validate = !$data && def2.compile ? def2.compile.call(it.self, schema, parentSchema, it) : def2.validate;
      const validateRef = useKeyword(gen, keyword, validate);
      const valid = gen.let("valid");
      cxt.block$data(valid, validateKeyword);
      cxt.ok((_a = def2.valid) !== null && _a !== void 0 ? _a : valid);
      function validateKeyword() {
        if (def2.errors === false) {
          assignValid();
          if (def2.modifying)
            modifyData(cxt);
          reportErrs(() => cxt.error());
        } else {
          const ruleErrs = def2.async ? validateAsync() : validateSync();
          if (def2.modifying)
            modifyData(cxt);
          reportErrs(() => addErrs(cxt, ruleErrs));
        }
      }
      function validateAsync() {
        const ruleErrs = gen.let("ruleErrs", null);
        gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
        return ruleErrs;
      }
      function validateSync() {
        const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
        gen.assign(validateErrs, null);
        assignValid(codegen_1.nil);
        return validateErrs;
      }
      function assignValid(_await = def2.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
        const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
        const passSchema = !("compile" in def2 && !$data || def2.schema === false);
        gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def2.modifying);
      }
      function reportErrs(errors) {
        var _a2;
        gen.if((0, codegen_1.not)((_a2 = def2.valid) !== null && _a2 !== void 0 ? _a2 : valid), errors);
      }
    }
    exports.funcKeywordCode = funcKeywordCode;
    function modifyData(cxt) {
      const { gen, data, it } = cxt;
      gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
    }
    function addErrs(cxt, errs) {
      const { gen } = cxt;
      gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
        (0, errors_1.extendErrors)(cxt);
      }, () => cxt.error());
    }
    function checkAsyncKeyword({ schemaEnv }, def2) {
      if (def2.async && !schemaEnv.$async)
        throw new Error("async keyword in sync schema");
    }
    function useKeyword(gen, keyword, result) {
      if (result === void 0)
        throw new Error(`keyword "${keyword}" failed to compile`);
      return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
    }
    function validSchemaType(schema, schemaType, allowUndefined = false) {
      return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
    }
    exports.validSchemaType = validSchemaType;
    function validateKeywordUsage({ schema, opts, self: self2, errSchemaPath }, def2, keyword) {
      if (Array.isArray(def2.keyword) ? !def2.keyword.includes(keyword) : def2.keyword !== keyword) {
        throw new Error("ajv implementation error");
      }
      const deps = def2.dependencies;
      if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
        throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
      }
      if (def2.validateSchema) {
        const valid = def2.validateSchema(schema[keyword]);
        if (!valid) {
          const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self2.errorsText(def2.validateSchema.errors);
          if (opts.validateSchema === "log")
            self2.logger.error(msg);
          else
            throw new Error(msg);
        }
      }
    }
    exports.validateKeywordUsage = validateKeywordUsage;
  }
});

// node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS({
  "node_modules/ajv/dist/compile/validate/subschema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
      if (keyword !== void 0 && schema !== void 0) {
        throw new Error('both "keyword" and "schema" passed, only one allowed');
      }
      if (keyword !== void 0) {
        const sch = it.schema[keyword];
        return schemaProp === void 0 ? {
          schema: sch,
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}`
        } : {
          schema: sch[schemaProp],
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
        };
      }
      if (schema !== void 0) {
        if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
          throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
        }
        return {
          schema,
          schemaPath,
          topSchemaRef,
          errSchemaPath
        };
      }
      throw new Error('either "keyword" or "schema" must be passed');
    }
    exports.getSubschema = getSubschema;
    function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
      if (data !== void 0 && dataProp !== void 0) {
        throw new Error('both "data" and "dataProp" passed, only one allowed');
      }
      const { gen } = it;
      if (dataProp !== void 0) {
        const { errorPath, dataPathArr, opts } = it;
        const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
        dataContextProps(nextData);
        subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
        subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
      }
      if (data !== void 0) {
        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
        dataContextProps(nextData);
        if (propertyName !== void 0)
          subschema.propertyName = propertyName;
      }
      if (dataTypes)
        subschema.dataTypes = dataTypes;
      function dataContextProps(_nextData) {
        subschema.data = _nextData;
        subschema.dataLevel = it.dataLevel + 1;
        subschema.dataTypes = [];
        it.definedProperties = /* @__PURE__ */ new Set();
        subschema.parentData = it.data;
        subschema.dataNames = [...it.dataNames, _nextData];
      }
    }
    exports.extendSubschemaData = extendSubschemaData;
    function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
      if (compositeRule !== void 0)
        subschema.compositeRule = compositeRule;
      if (createErrors !== void 0)
        subschema.createErrors = createErrors;
      if (allErrors !== void 0)
        subschema.allErrors = allErrors;
      subschema.jtdDiscriminator = jtdDiscriminator;
      subschema.jtdMetadata = jtdMetadata;
    }
    exports.extendSubschemaMode = extendSubschemaMode;
  }
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS({
  "node_modules/json-schema-traverse/index.js"(exports, module) {
    "use strict";
    var traverse = module.exports = function(schema, opts, cb) {
      if (typeof opts == "function") {
        cb = opts;
        opts = {};
      }
      cb = opts.cb || cb;
      var pre = typeof cb == "function" ? cb : cb.pre || function() {
      };
      var post = cb.post || function() {
      };
      _traverse(opts, pre, post, schema, "", schema);
    };
    traverse.keywords = {
      additionalItems: true,
      items: true,
      contains: true,
      additionalProperties: true,
      propertyNames: true,
      not: true,
      if: true,
      then: true,
      else: true
    };
    traverse.arrayKeywords = {
      items: true,
      allOf: true,
      anyOf: true,
      oneOf: true
    };
    traverse.propsKeywords = {
      $defs: true,
      definitions: true,
      properties: true,
      patternProperties: true,
      dependencies: true
    };
    traverse.skipKeywords = {
      default: true,
      enum: true,
      const: true,
      required: true,
      maximum: true,
      minimum: true,
      exclusiveMaximum: true,
      exclusiveMinimum: true,
      multipleOf: true,
      maxLength: true,
      minLength: true,
      pattern: true,
      format: true,
      maxItems: true,
      minItems: true,
      uniqueItems: true,
      maxProperties: true,
      minProperties: true
    };
    function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
      if (schema && typeof schema == "object" && !Array.isArray(schema)) {
        pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
        for (var key in schema) {
          var sch = schema[key];
          if (Array.isArray(sch)) {
            if (key in traverse.arrayKeywords) {
              for (var i = 0; i < sch.length; i++)
                _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
            }
          } else if (key in traverse.propsKeywords) {
            if (sch && typeof sch == "object") {
              for (var prop in sch)
                _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
            }
          } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
            _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
          }
        }
        post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      }
    }
    function escapeJsonPtr(str) {
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
  }
});

// node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS({
  "node_modules/ajv/dist/compile/resolve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = void 0;
    var util_1 = require_util();
    var equal = require_fast_deep_equal();
    var traverse = require_json_schema_traverse();
    var SIMPLE_INLINED = /* @__PURE__ */ new Set([
      "type",
      "format",
      "pattern",
      "maxLength",
      "minLength",
      "maxProperties",
      "minProperties",
      "maxItems",
      "minItems",
      "maximum",
      "minimum",
      "uniqueItems",
      "multipleOf",
      "required",
      "enum",
      "const"
    ]);
    function inlineRef(schema, limit = true) {
      if (typeof schema == "boolean")
        return true;
      if (limit === true)
        return !hasRef(schema);
      if (!limit)
        return false;
      return countKeys(schema) <= limit;
    }
    exports.inlineRef = inlineRef;
    var REF_KEYWORDS = /* @__PURE__ */ new Set([
      "$ref",
      "$recursiveRef",
      "$recursiveAnchor",
      "$dynamicRef",
      "$dynamicAnchor"
    ]);
    function hasRef(schema) {
      for (const key in schema) {
        if (REF_KEYWORDS.has(key))
          return true;
        const sch = schema[key];
        if (Array.isArray(sch) && sch.some(hasRef))
          return true;
        if (typeof sch == "object" && hasRef(sch))
          return true;
      }
      return false;
    }
    function countKeys(schema) {
      let count = 0;
      for (const key in schema) {
        if (key === "$ref")
          return Infinity;
        count++;
        if (SIMPLE_INLINED.has(key))
          continue;
        if (typeof schema[key] == "object") {
          (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
        }
        if (count === Infinity)
          return Infinity;
      }
      return count;
    }
    function getFullPath(resolver, id = "", normalize) {
      if (normalize !== false)
        id = normalizeId(id);
      const p = resolver.parse(id);
      return _getFullPath(resolver, p);
    }
    exports.getFullPath = getFullPath;
    function _getFullPath(resolver, p) {
      const serialized = resolver.serialize(p);
      return serialized.split("#")[0] + "#";
    }
    exports._getFullPath = _getFullPath;
    var TRAILING_SLASH_HASH = /#\/?$/;
    function normalizeId(id) {
      return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
    }
    exports.normalizeId = normalizeId;
    function resolveUrl(resolver, baseId, id) {
      id = normalizeId(id);
      return resolver.resolve(baseId, id);
    }
    exports.resolveUrl = resolveUrl;
    var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
    function getSchemaRefs(schema, baseId) {
      if (typeof schema == "boolean")
        return {};
      const { schemaId, uriResolver } = this.opts;
      const schId = normalizeId(schema[schemaId] || baseId);
      const baseIds = { "": schId };
      const pathPrefix = getFullPath(uriResolver, schId, false);
      const localRefs = {};
      const schemaRefs = /* @__PURE__ */ new Set();
      traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === void 0)
          return;
        const fullPath = pathPrefix + jsonPtr;
        let innerBaseId = baseIds[parentJsonPtr];
        if (typeof sch[schemaId] == "string")
          innerBaseId = addRef.call(this, sch[schemaId]);
        addAnchor.call(this, sch.$anchor);
        addAnchor.call(this, sch.$dynamicAnchor);
        baseIds[jsonPtr] = innerBaseId;
        function addRef(ref) {
          const _resolve = this.opts.uriResolver.resolve;
          ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
          if (schemaRefs.has(ref))
            throw ambiguos(ref);
          schemaRefs.add(ref);
          let schOrRef = this.refs[ref];
          if (typeof schOrRef == "string")
            schOrRef = this.refs[schOrRef];
          if (typeof schOrRef == "object") {
            checkAmbiguosRef(sch, schOrRef.schema, ref);
          } else if (ref !== normalizeId(fullPath)) {
            if (ref[0] === "#") {
              checkAmbiguosRef(sch, localRefs[ref], ref);
              localRefs[ref] = sch;
            } else {
              this.refs[ref] = fullPath;
            }
          }
          return ref;
        }
        function addAnchor(anchor) {
          if (typeof anchor == "string") {
            if (!ANCHOR.test(anchor))
              throw new Error(`invalid anchor "${anchor}"`);
            addRef.call(this, `#${anchor}`);
          }
        }
      });
      return localRefs;
      function checkAmbiguosRef(sch1, sch2, ref) {
        if (sch2 !== void 0 && !equal(sch1, sch2))
          throw ambiguos(ref);
      }
      function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
      }
    }
    exports.getSchemaRefs = getSchemaRefs;
  }
});

// node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS({
  "node_modules/ajv/dist/compile/validate/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getData = exports.KeywordCxt = exports.validateFunctionCode = void 0;
    var boolSchema_1 = require_boolSchema();
    var dataType_1 = require_dataType();
    var applicability_1 = require_applicability();
    var dataType_2 = require_dataType();
    var defaults_1 = require_defaults();
    var keyword_1 = require_keyword();
    var subschema_1 = require_subschema();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var errors_1 = require_errors();
    function validateFunctionCode(it) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          topSchemaObjCode(it);
          return;
        }
      }
      validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
    }
    exports.validateFunctionCode = validateFunctionCode;
    function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
      if (opts.code.es5) {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
          gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
          destructureValCxtES5(gen, opts);
          gen.code(body);
        });
      } else {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
      }
    }
    function destructureValCxt(opts) {
      return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
    }
    function destructureValCxtES5(gen, opts) {
      gen.if(names_1.default.valCxt, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
        gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
      }, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.rootData, names_1.default.data);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
      });
    }
    function topSchemaObjCode(it) {
      const { schema, opts, gen } = it;
      validateFunction(it, () => {
        if (opts.$comment && schema.$comment)
          commentKeyword(it);
        checkNoDefault(it);
        gen.let(names_1.default.vErrors, null);
        gen.let(names_1.default.errors, 0);
        if (opts.unevaluated)
          resetEvaluated(it);
        typeAndKeywords(it);
        returnResults(it);
      });
      return;
    }
    function resetEvaluated(it) {
      const { gen, validateName } = it;
      it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
    }
    function funcSourceUrl(schema, opts) {
      const schId = typeof schema == "object" && schema[opts.schemaId];
      return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
    }
    function subschemaCode(it, valid) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          subSchemaObjCode(it, valid);
          return;
        }
      }
      (0, boolSchema_1.boolOrEmptySchema)(it, valid);
    }
    function schemaCxtHasRules({ schema, self: self2 }) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (self2.RULES.all[key])
          return true;
      return false;
    }
    function isSchemaObj(it) {
      return typeof it.schema != "boolean";
    }
    function subSchemaObjCode(it, valid) {
      const { schema, gen, opts } = it;
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      updateContext(it);
      checkAsyncSchema(it);
      const errsCount = gen.const("_errs", names_1.default.errors);
      typeAndKeywords(it, errsCount);
      gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
    }
    function checkKeywords(it) {
      (0, util_1.checkUnknownRules)(it);
      checkRefsAndKeywords(it);
    }
    function typeAndKeywords(it, errsCount) {
      if (it.opts.jtd)
        return schemaKeywords(it, [], false, errsCount);
      const types = (0, dataType_1.getSchemaTypes)(it.schema);
      const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
      schemaKeywords(it, types, !checkedTypes, errsCount);
    }
    function checkRefsAndKeywords(it) {
      const { schema, errSchemaPath, opts, self: self2 } = it;
      if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self2.RULES)) {
        self2.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
      }
    }
    function checkNoDefault(it) {
      const { schema, opts } = it;
      if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
        (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
      }
    }
    function updateContext(it) {
      const schId = it.schema[it.opts.schemaId];
      if (schId)
        it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
    }
    function checkAsyncSchema(it) {
      if (it.schema.$async && !it.schemaEnv.$async)
        throw new Error("async schema in sync schema");
    }
    function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
      const msg = schema.$comment;
      if (opts.$comment === true) {
        gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
      } else if (typeof opts.$comment == "function") {
        const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
        const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
        gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
      }
    }
    function returnResults(it) {
      const { gen, schemaEnv, validateName, ValidationError, opts } = it;
      if (schemaEnv.$async) {
        gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
        if (opts.unevaluated)
          assignEvaluated(it);
        gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
      }
    }
    function assignEvaluated({ gen, evaluated, props, items }) {
      if (props instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.props`, props);
      if (items instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.items`, items);
    }
    function schemaKeywords(it, types, typeErrors, errsCount) {
      const { gen, schema, data, allErrors, opts, self: self2 } = it;
      const { RULES } = self2;
      if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
        gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
        return;
      }
      if (!opts.jtd)
        checkStrictTypes(it, types);
      gen.block(() => {
        for (const group of RULES.rules)
          groupKeywords(group);
        groupKeywords(RULES.post);
      });
      function groupKeywords(group) {
        if (!(0, applicability_1.shouldUseGroup)(schema, group))
          return;
        if (group.type) {
          gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
          iterateKeywords(it, group);
          if (types.length === 1 && types[0] === group.type && typeErrors) {
            gen.else();
            (0, dataType_2.reportTypeError)(it);
          }
          gen.endIf();
        } else {
          iterateKeywords(it, group);
        }
        if (!allErrors)
          gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
      }
    }
    function iterateKeywords(it, group) {
      const { gen, schema, opts: { useDefaults } } = it;
      if (useDefaults)
        (0, defaults_1.assignDefaults)(it, group.type);
      gen.block(() => {
        for (const rule of group.rules) {
          if ((0, applicability_1.shouldUseRule)(schema, rule)) {
            keywordCode(it, rule.keyword, rule.definition, group.type);
          }
        }
      });
    }
    function checkStrictTypes(it, types) {
      if (it.schemaEnv.meta || !it.opts.strictTypes)
        return;
      checkContextTypes(it, types);
      if (!it.opts.allowUnionTypes)
        checkMultipleTypes(it, types);
      checkKeywordTypes(it, it.dataTypes);
    }
    function checkContextTypes(it, types) {
      if (!types.length)
        return;
      if (!it.dataTypes.length) {
        it.dataTypes = types;
        return;
      }
      types.forEach((t) => {
        if (!includesType(it.dataTypes, t)) {
          strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
        }
      });
      narrowSchemaTypes(it, types);
    }
    function checkMultipleTypes(it, ts) {
      if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
        strictTypesError(it, "use allowUnionTypes to allow union type keyword");
      }
    }
    function checkKeywordTypes(it, ts) {
      const rules = it.self.RULES.all;
      for (const keyword in rules) {
        const rule = rules[keyword];
        if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
          const { type } = rule.definition;
          if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
            strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
          }
        }
      }
    }
    function hasApplicableType(schTs, kwdT) {
      return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
    }
    function includesType(ts, t) {
      return ts.includes(t) || t === "integer" && ts.includes("number");
    }
    function narrowSchemaTypes(it, withTypes) {
      const ts = [];
      for (const t of it.dataTypes) {
        if (includesType(withTypes, t))
          ts.push(t);
        else if (withTypes.includes("integer") && t === "number")
          ts.push("integer");
      }
      it.dataTypes = ts;
    }
    function strictTypesError(it, msg) {
      const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
      msg += ` at "${schemaPath}" (strictTypes)`;
      (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
    }
    var KeywordCxt = class {
      constructor(it, def2, keyword) {
        (0, keyword_1.validateKeywordUsage)(it, def2, keyword);
        this.gen = it.gen;
        this.allErrors = it.allErrors;
        this.keyword = keyword;
        this.data = it.data;
        this.schema = it.schema[keyword];
        this.$data = def2.$data && it.opts.$data && this.schema && this.schema.$data;
        this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
        this.schemaType = def2.schemaType;
        this.parentSchema = it.schema;
        this.params = {};
        this.it = it;
        this.def = def2;
        if (this.$data) {
          this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
        } else {
          this.schemaCode = this.schemaValue;
          if (!(0, keyword_1.validSchemaType)(this.schema, def2.schemaType, def2.allowUndefined)) {
            throw new Error(`${keyword} value must be ${JSON.stringify(def2.schemaType)}`);
          }
        }
        if ("code" in def2 ? def2.trackErrors : def2.errors !== false) {
          this.errsCount = it.gen.const("_errs", names_1.default.errors);
        }
      }
      result(condition, successAction, failAction) {
        this.failResult((0, codegen_1.not)(condition), successAction, failAction);
      }
      failResult(condition, successAction, failAction) {
        this.gen.if(condition);
        if (failAction)
          failAction();
        else
          this.error();
        if (successAction) {
          this.gen.else();
          successAction();
          if (this.allErrors)
            this.gen.endIf();
        } else {
          if (this.allErrors)
            this.gen.endIf();
          else
            this.gen.else();
        }
      }
      pass(condition, failAction) {
        this.failResult((0, codegen_1.not)(condition), void 0, failAction);
      }
      fail(condition) {
        if (condition === void 0) {
          this.error();
          if (!this.allErrors)
            this.gen.if(false);
          return;
        }
        this.gen.if(condition);
        this.error();
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
      fail$data(condition) {
        if (!this.$data)
          return this.fail(condition);
        const { schemaCode } = this;
        this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
      }
      error(append, errorParams, errorPaths) {
        if (errorParams) {
          this.setParams(errorParams);
          this._error(append, errorPaths);
          this.setParams({});
          return;
        }
        this._error(append, errorPaths);
      }
      _error(append, errorPaths) {
        ;
        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
      }
      $dataError() {
        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
      }
      reset() {
        if (this.errsCount === void 0)
          throw new Error('add "trackErrors" to keyword definition');
        (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
      }
      ok(cond) {
        if (!this.allErrors)
          this.gen.if(cond);
      }
      setParams(obj, assign) {
        if (assign)
          Object.assign(this.params, obj);
        else
          this.params = obj;
      }
      block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
        this.gen.block(() => {
          this.check$data(valid, $dataValid);
          codeBlock();
        });
      }
      check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
        if (!this.$data)
          return;
        const { gen, schemaCode, schemaType, def: def2 } = this;
        gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
        if (valid !== codegen_1.nil)
          gen.assign(valid, true);
        if (schemaType.length || def2.validateSchema) {
          gen.elseIf(this.invalid$data());
          this.$dataError();
          if (valid !== codegen_1.nil)
            gen.assign(valid, false);
        }
        gen.else();
      }
      invalid$data() {
        const { gen, schemaCode, schemaType, def: def2, it } = this;
        return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
        function wrong$DataType() {
          if (schemaType.length) {
            if (!(schemaCode instanceof codegen_1.Name))
              throw new Error("ajv implementation error");
            const st = Array.isArray(schemaType) ? schemaType : [schemaType];
            return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
          }
          return codegen_1.nil;
        }
        function invalid$DataSchema() {
          if (def2.validateSchema) {
            const validateSchemaRef = gen.scopeValue("validate$data", { ref: def2.validateSchema });
            return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
          }
          return codegen_1.nil;
        }
      }
      subschema(appl, valid) {
        const subschema = (0, subschema_1.getSubschema)(this.it, appl);
        (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
        (0, subschema_1.extendSubschemaMode)(subschema, appl);
        const nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
        subschemaCode(nextContext, valid);
        return nextContext;
      }
      mergeEvaluated(schemaCxt, toName) {
        const { it, gen } = this;
        if (!it.opts.unevaluated)
          return;
        if (it.props !== true && schemaCxt.props !== void 0) {
          it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
        }
        if (it.items !== true && schemaCxt.items !== void 0) {
          it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
        }
      }
      mergeValidEvaluated(schemaCxt, valid) {
        const { it, gen } = this;
        if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
          gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
          return true;
        }
      }
    };
    exports.KeywordCxt = KeywordCxt;
    function keywordCode(it, keyword, def2, ruleType) {
      const cxt = new KeywordCxt(it, def2, keyword);
      if ("code" in def2) {
        def2.code(cxt, ruleType);
      } else if (cxt.$data && def2.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def2);
      } else if ("macro" in def2) {
        (0, keyword_1.macroKeywordCode)(cxt, def2);
      } else if (def2.compile || def2.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def2);
      }
    }
    var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
    var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
    function getData($data, { dataLevel, dataNames, dataPathArr }) {
      let jsonPointer;
      let data;
      if ($data === "")
        return names_1.default.rootData;
      if ($data[0] === "/") {
        if (!JSON_POINTER.test($data))
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        jsonPointer = $data;
        data = names_1.default.rootData;
      } else {
        const matches = RELATIVE_JSON_POINTER.exec($data);
        if (!matches)
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        const up = +matches[1];
        jsonPointer = matches[2];
        if (jsonPointer === "#") {
          if (up >= dataLevel)
            throw new Error(errorMsg("property/index", up));
          return dataPathArr[dataLevel - up];
        }
        if (up > dataLevel)
          throw new Error(errorMsg("data", up));
        data = dataNames[dataLevel - up];
        if (!jsonPointer)
          return data;
      }
      let expr = data;
      const segments = jsonPointer.split("/");
      for (const segment of segments) {
        if (segment) {
          data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
          expr = (0, codegen_1._)`${expr} && ${data}`;
        }
      }
      return expr;
      function errorMsg(pointerType, up) {
        return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
      }
    }
    exports.getData = getData;
  }
});

// node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS({
  "node_modules/ajv/dist/runtime/validation_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var ValidationError = class extends Error {
      constructor(errors) {
        super("validation failed");
        this.errors = errors;
        this.ajv = this.validation = true;
      }
    };
    exports.default = ValidationError;
  }
});

// node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS({
  "node_modules/ajv/dist/compile/ref_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var resolve_1 = require_resolve();
    var MissingRefError = class extends Error {
      constructor(resolver, baseId, ref, msg) {
        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
      }
    };
    exports.default = MissingRefError;
  }
});

// node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS({
  "node_modules/ajv/dist/compile/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = void 0;
    var codegen_1 = require_codegen();
    var validation_error_1 = require_validation_error();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var validate_1 = require_validate();
    var SchemaEnv = class {
      constructor(env) {
        var _a;
        this.refs = {};
        this.dynamicAnchors = {};
        let schema;
        if (typeof env.schema == "object")
          schema = env.schema;
        this.schema = env.schema;
        this.schemaId = env.schemaId;
        this.root = env.root || this;
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
      }
    };
    exports.SchemaEnv = SchemaEnv;
    function compileSchema(sch) {
      const _sch = getCompilingSchema.call(this, sch);
      if (_sch)
        return _sch;
      const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
      const { es5, lines } = this.opts.code;
      const { ownProperties } = this.opts;
      const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
      let _ValidationError;
      if (sch.$async) {
        _ValidationError = gen.scopeValue("Error", {
          ref: validation_error_1.default,
          code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
        });
      }
      const validateName = gen.scopeName("validate");
      sch.validateName = validateName;
      const schemaCxt = {
        gen,
        allErrors: this.opts.allErrors,
        data: names_1.default.data,
        parentData: names_1.default.parentData,
        parentDataProperty: names_1.default.parentDataProperty,
        dataNames: [names_1.default.data],
        dataPathArr: [codegen_1.nil],
        // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: /* @__PURE__ */ new Set(),
        topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
        validateName,
        ValidationError: _ValidationError,
        schema: sch.schema,
        schemaEnv: sch,
        rootId,
        baseId: sch.baseId || rootId,
        schemaPath: codegen_1.nil,
        errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
        errorPath: (0, codegen_1._)`""`,
        opts: this.opts,
        self: this
      };
      let sourceCode;
      try {
        this._compilations.add(sch);
        (0, validate_1.validateFunctionCode)(schemaCxt);
        gen.optimize(this.opts.code.optimize);
        const validateCode = gen.toString();
        sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
        if (this.opts.code.process)
          sourceCode = this.opts.code.process(sourceCode, sch);
        const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
        const validate = makeValidate(this, this.scope.get());
        this.scope.value(validateName, { ref: validate });
        validate.errors = null;
        validate.schema = sch.schema;
        validate.schemaEnv = sch;
        if (sch.$async)
          validate.$async = true;
        if (this.opts.code.source === true) {
          validate.source = { validateName, validateCode, scopeValues: gen._values };
        }
        if (this.opts.unevaluated) {
          const { props, items } = schemaCxt;
          validate.evaluated = {
            props: props instanceof codegen_1.Name ? void 0 : props,
            items: items instanceof codegen_1.Name ? void 0 : items,
            dynamicProps: props instanceof codegen_1.Name,
            dynamicItems: items instanceof codegen_1.Name
          };
          if (validate.source)
            validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
        }
        sch.validate = validate;
        return sch;
      } catch (e) {
        delete sch.validate;
        delete sch.validateName;
        if (sourceCode)
          this.logger.error("Error compiling schema, function code:", sourceCode);
        throw e;
      } finally {
        this._compilations.delete(sch);
      }
    }
    exports.compileSchema = compileSchema;
    function resolveRef(root, baseId, ref) {
      var _a;
      ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
      const schOrFunc = root.refs[ref];
      if (schOrFunc)
        return schOrFunc;
      let _sch = resolve4.call(this, root, ref);
      if (_sch === void 0) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
        const { schemaId } = this.opts;
        if (schema)
          _sch = new SchemaEnv({ schema, schemaId, root, baseId });
      }
      if (_sch === void 0)
        return;
      return root.refs[ref] = inlineOrCompile.call(this, _sch);
    }
    exports.resolveRef = resolveRef;
    function inlineOrCompile(sch) {
      if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
        return sch.schema;
      return sch.validate ? sch : compileSchema.call(this, sch);
    }
    function getCompilingSchema(schEnv) {
      for (const sch of this._compilations) {
        if (sameSchemaEnv(sch, schEnv))
          return sch;
      }
    }
    exports.getCompilingSchema = getCompilingSchema;
    function sameSchemaEnv(s1, s2) {
      return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
    }
    function resolve4(root, ref) {
      let sch;
      while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
      return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
    }
    function resolveSchema(root, ref) {
      const p = this.opts.uriResolver.parse(ref);
      const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
      let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
      if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
      }
      const id = (0, resolve_1.normalizeId)(refPath);
      const schOrRef = this.refs[id] || this.schemas[id];
      if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
          return;
        return getJsonPointer.call(this, p, sch);
      }
      if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
        return;
      if (!schOrRef.validate)
        compileSchema.call(this, schOrRef);
      if (id === (0, resolve_1.normalizeId)(ref)) {
        const { schema } = schOrRef;
        const { schemaId } = this.opts;
        const schId = schema[schemaId];
        if (schId)
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        return new SchemaEnv({ schema, schemaId, root, baseId });
      }
      return getJsonPointer.call(this, p, schOrRef);
    }
    exports.resolveSchema = resolveSchema;
    var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "enum",
      "dependencies",
      "definitions"
    ]);
    function getJsonPointer(parsedRef, { baseId, schema, root }) {
      var _a;
      if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
      for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
          return;
        const partSchema = schema[(0, util_1.unescapeFragment)(part)];
        if (partSchema === void 0)
          return;
        schema = partSchema;
        const schId = typeof schema === "object" && schema[this.opts.schemaId];
        if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        }
      }
      let env;
      if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
        const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
        env = resolveSchema.call(this, root, $ref);
      }
      const { schemaId } = this.opts;
      env = env || new SchemaEnv({ schema, schemaId, root, baseId });
      if (env.schema !== env.root.schema)
        return env;
      return void 0;
    }
  }
});

// node_modules/ajv/dist/refs/data.json
var require_data = __commonJS({
  "node_modules/ajv/dist/refs/data.json"(exports, module) {
    module.exports = {
      $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
      description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
      type: "object",
      required: ["$data"],
      properties: {
        $data: {
          type: "string",
          anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
        }
      },
      additionalProperties: false
    };
  }
});

// node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS({
  "node_modules/fast-uri/lib/utils.js"(exports, module) {
    "use strict";
    var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
    var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
    var isPort = RegExp.prototype.test.bind(/^\d*$/u);
    var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
    var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
    var isPathCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u);
    var isQueryFragmentCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/u);
    var isUserinfoCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:]$/u);
    var BYTE_HEX = new Array(256);
    {
      const HEX_DIGITS = "0123456789ABCDEF";
      for (let i = 0; i < 256; i++) {
        BYTE_HEX[i] = "%" + HEX_DIGITS[i >> 4] + HEX_DIGITS[i & 15];
      }
    }
    function percentEncodeNonAscii(cp) {
      if (cp < 2048) {
        return BYTE_HEX[192 | cp >> 6] + BYTE_HEX[128 | cp & 63];
      }
      if (cp < 65536) {
        return BYTE_HEX[224 | cp >> 12] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
      }
      return BYTE_HEX[240 | cp >> 18] + BYTE_HEX[128 | cp >> 12 & 63] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
    }
    function stringArrayToHexStripped(input) {
      let acc = "";
      let code = 0;
      let i = 0;
      for (i = 0; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (code === 48) {
          continue;
        }
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
        break;
      }
      for (i += 1; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
      }
      return acc;
    }
    var isHextet = RegExp.prototype.test.bind(/^[\dA-Fa-f]{1,4}$/);
    var isIPvFuture = RegExp.prototype.test.bind(/^[vV][\dA-Fa-f]+\.[A-Za-z\d\-._~!$&'()*+,;=:]+$/);
    var isZoneCharacter = RegExp.prototype.test.bind(/^[A-Za-z\d\-._~]$/);
    var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
    function isZoneIdentifier(zone) {
      if (zone.length === 0) return false;
      for (let i = 0; i < zone.length; i++) {
        if (isZoneCharacter(zone[i])) continue;
        if (zone[i] === "%" && i + 2 < zone.length && isHexPair(zone.slice(i + 1, i + 3))) {
          i += 2;
          continue;
        }
        return false;
      }
      return true;
    }
    function compressIPv6ZeroRun(hextets) {
      let bestStart = -1;
      let bestLength = 0;
      let runStart = -1;
      let runLength = 0;
      for (let i = 0; i < hextets.length; i++) {
        if (hextets[i] === "0") {
          if (runStart === -1) runStart = i;
          runLength++;
          if (runLength > bestLength) {
            bestLength = runLength;
            bestStart = runStart;
          }
        } else {
          runStart = -1;
          runLength = 0;
        }
      }
      if (bestLength < 2) return hextets.join(":");
      const head = hextets.slice(0, bestStart).join(":");
      const tail = hextets.slice(bestStart + bestLength).join(":");
      return head + "::" + tail;
    }
    function normalizeIPv6Address(input) {
      const compression = input.indexOf("::");
      if (compression !== -1 && input.indexOf("::", compression + 1) !== -1) return void 0;
      const left = compression === -1 ? input.split(":") : input.slice(0, compression).split(":");
      const right = compression === -1 ? [] : input.slice(compression + 2).split(":");
      if (compression !== -1) {
        if (left.length === 1 && left[0] === "") left.length = 0;
        if (right.length === 1 && right[0] === "") right.length = 0;
      }
      const parts = left.concat(right);
      let hextetCount = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "") return void 0;
        if (part.indexOf(".") !== -1) {
          if (i !== parts.length - 1 || compression !== -1 && right.length === 0 || !isIPv4(part)) return void 0;
          hextetCount += 2;
          continue;
        }
        if (!isHextet(part)) return void 0;
        parts[i] = parseInt(part, 16).toString(16);
        hextetCount++;
      }
      if (compression === -1) {
        if (hextetCount !== 8) return void 0;
        return compressIPv6ZeroRun(parts);
      }
      if (hextetCount >= 8) return void 0;
      const expanded = parts.slice(0, left.length);
      for (let i = hextetCount; i < 8; i++) expanded.push("0");
      for (let i = left.length; i < parts.length; i++) expanded.push(parts[i]);
      return compressIPv6ZeroRun(expanded);
    }
    function normalizeIPv6(host) {
      const bracketed = host[0] === "[" && host[host.length - 1] === "]";
      const hasBracket = host[0] === "[" || host[host.length - 1] === "]";
      if (hasBracket && !bracketed) return { host, isIPV6: false, error: true };
      let input = bracketed ? host.slice(1, -1) : host;
      if (bracketed && isIPvFuture(input)) {
        input = input.toLowerCase();
        return { host: `[${input}]`, escapedHost: input, isIPV6: false, isIPVFuture: true };
      }
      if (findToken(input, ":") < 2) {
        return { host, isIPV6: false, error: bracketed };
      }
      let zoneIdentifier = "";
      const zoneSeparator = input.indexOf("%");
      if (zoneSeparator !== -1) {
        const separatorLength = input.slice(zoneSeparator, zoneSeparator + 3).toLowerCase() === "%25" ? 3 : 1;
        zoneIdentifier = input.slice(zoneSeparator + separatorLength);
        if (!isZoneIdentifier(zoneIdentifier)) return { host, isIPV6: false, error: true };
        input = input.slice(0, zoneSeparator);
      }
      const address = normalizeIPv6Address(input);
      if (address === void 0) return { host, isIPV6: false, error: true };
      return {
        host: address + (zoneIdentifier ? "%" + zoneIdentifier : ""),
        escapedHost: address + (zoneIdentifier ? "%25" + zoneIdentifier : ""),
        isIPV6: true
      };
    }
    function findToken(str, token) {
      let ind = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === token) ind++;
      }
      return ind;
    }
    function removeDotSegments(path8) {
      let input = path8;
      const output = [];
      let nextSlash = -1;
      let len = 0;
      while (len = input.length) {
        if (len === 1) {
          if (input === ".") {
            break;
          } else if (input === "/") {
            output.push("/");
            break;
          } else {
            output.push(input);
            break;
          }
        } else if (len === 2) {
          if (input[0] === ".") {
            if (input[1] === ".") {
              break;
            } else if (input[1] === "/") {
              input = input.slice(2);
              continue;
            }
          } else if (input[0] === "/") {
            if (input[1] === "." || input[1] === "/") {
              output.push("/");
              break;
            }
          }
        } else if (len === 3) {
          if (input === "/..") {
            if (output.length !== 0) {
              output.pop();
            }
            output.push("/");
            break;
          }
        }
        if (input[0] === ".") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(3);
              continue;
            }
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(2);
              continue;
            } else if (input[2] === ".") {
              if (input[3] === "/") {
                input = input.slice(3);
                if (output.length !== 0) {
                  output.pop();
                }
                continue;
              }
            }
          }
        }
        if ((nextSlash = input.indexOf("/", 1)) === -1) {
          output.push(input);
          break;
        } else {
          output.push(input.slice(0, nextSlash));
          input = input.slice(nextSlash);
        }
      }
      return output.join("");
    }
    var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
    var HOST_DELIM_RE = /[@/?#:]/g;
    var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
    function reescapeHostDelimiters(host, isIP) {
      const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
      re.lastIndex = 0;
      return host.replace(re, (ch) => HOST_DELIMS[ch]);
    }
    function normalizePercentEncoding(input, decodeUnreserved = false) {
      if (input.indexOf("%") === -1) {
        return input;
      }
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decodeUnreserved && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        output += input[i];
      }
      return output;
    }
    function normalizePathEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decoded !== "." && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isPathCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function serializePathEncoding(input, pathNoScheme = false) {
      let output = "";
      let firstSegment = pathNoScheme && input[0] !== "/";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (ch === "/") {
          firstSegment = false;
        }
        if (isPathCharacter(ch) && (ch !== ":" || !firstSegment)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeComponent(input, isAllowed) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (isAllowed(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeUserinfo(input) {
      return encodeComponent(input, isUserinfoCharacter);
    }
    function encodeQuery(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function encodeFragment(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function isEscapeSafe(cp) {
      return cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp === 42 || cp === 43 || cp === 45 || cp === 46 || cp === 47 || cp === 64 || cp === 95;
    }
    function normalizeQueryFragmentEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isQueryFragmentCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function escapePreservingEscapes(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        output += escape(input[i]);
      }
      return output;
    }
    function recomposeAuthority(component) {
      const uriTokens = [];
      if (component.userinfo !== void 0) {
        uriTokens.push(encodeUserinfo(component.userinfo));
        uriTokens.push("@");
      }
      if (component.host !== void 0) {
        let host = component.host;
        if (!isIPv4(host)) {
          let ipV6res = normalizeIPv6(host);
          if (ipV6res.isIPV6 !== true && ipV6res.isIPVFuture !== true) {
            host = normalizePercentEncoding(host, true);
            ipV6res = normalizeIPv6(host);
          }
          if (ipV6res.isIPV6 === true || ipV6res.isIPVFuture === true) {
            host = `[${ipV6res.escapedHost}]`;
          } else {
            host = reescapeHostDelimiters(host, false);
          }
        }
        uriTokens.push(host);
      }
      if (typeof component.port === "number" || typeof component.port === "string") {
        const port = String(component.port);
        if (!isPort(port)) {
          throw new TypeError("URI port is malformed.");
        }
        uriTokens.push(":");
        uriTokens.push(port);
      }
      return uriTokens.length ? uriTokens.join("") : void 0;
    }
    module.exports = {
      nonSimpleDomain,
      recomposeAuthority,
      reescapeHostDelimiters,
      normalizePercentEncoding,
      normalizePathEncoding,
      serializePathEncoding,
      normalizeQueryFragmentEncoding,
      encodeUserinfo,
      encodeQuery,
      encodeFragment,
      escapePreservingEscapes,
      removeDotSegments,
      isIPv4,
      isUUID,
      normalizeIPv6,
      stringArrayToHexStripped
    };
  }
});

// node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS({
  "node_modules/fast-uri/lib/schemes.js"(exports, module) {
    "use strict";
    var { isUUID } = require_utils();
    var URN_REG = /^([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-./:;=@]|%[\da-f]{2})+)$/iu;
    var supportedSchemeNames = (
      /** @type {const} */
      [
        "http",
        "https",
        "ws",
        "wss",
        "urn",
        "urn:uuid"
      ]
    );
    function isValidSchemeName(name) {
      return supportedSchemeNames.indexOf(
        /** @type {*} */
        name
      ) !== -1;
    }
    function wsIsSecure(wsComponent) {
      if (wsComponent.secure === true) {
        return true;
      } else if (wsComponent.secure === false) {
        return false;
      } else if (wsComponent.scheme) {
        return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
      } else {
        return false;
      }
    }
    function httpParse(component) {
      if (!component.host) {
        component.error = component.error || "HTTP URIs must have a host.";
      }
      return component;
    }
    function httpSerialize(component) {
      const secure = String(component.scheme).toLowerCase() === "https";
      if (component.port === (secure ? 443 : 80) || component.port === "") {
        component.port = void 0;
      }
      if (!component.path) {
        component.path = "/";
      }
      return component;
    }
    function wsParse(wsComponent) {
      wsComponent.secure = wsIsSecure(wsComponent);
      wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
      wsComponent.path = void 0;
      wsComponent.query = void 0;
      return wsComponent;
    }
    function wsSerialize(wsComponent) {
      if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
        wsComponent.port = void 0;
      }
      if (typeof wsComponent.secure === "boolean") {
        wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
        wsComponent.secure = void 0;
      }
      if (wsComponent.resourceName) {
        const queryIndex = wsComponent.resourceName.indexOf("?");
        const path8 = queryIndex === -1 ? wsComponent.resourceName : wsComponent.resourceName.slice(0, queryIndex);
        wsComponent.path = path8 && path8 !== "/" ? path8 : void 0;
        wsComponent.query = queryIndex === -1 ? void 0 : wsComponent.resourceName.slice(queryIndex + 1);
        wsComponent.resourceName = void 0;
      }
      wsComponent.fragment = void 0;
      return wsComponent;
    }
    function urnParse(urnComponent, options) {
      if (!urnComponent.path) {
        urnComponent.error = "URN can not be parsed";
        return urnComponent;
      }
      const matches = urnComponent.path.match(URN_REG);
      if (matches && matches[0] === urnComponent.path) {
        const scheme = options.scheme || urnComponent.scheme || "urn";
        urnComponent.nid = matches[1].toLowerCase();
        urnComponent.nss = matches[2];
        const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
        const schemeHandler = getSchemeHandler(urnScheme);
        urnComponent.path = void 0;
        if (schemeHandler) {
          urnComponent = schemeHandler.parse(urnComponent, options);
        }
      } else {
        urnComponent.error = urnComponent.error || "URN can not be parsed.";
      }
      return urnComponent;
    }
    function urnSerialize(urnComponent, options) {
      if (urnComponent.nid === void 0) {
        throw new Error("URN without nid cannot be serialized");
      }
      const scheme = options.scheme || urnComponent.scheme || "urn";
      const nid = urnComponent.nid.toLowerCase();
      const urnScheme = `${scheme}:${options.nid || nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      if (schemeHandler) {
        urnComponent = schemeHandler.serialize(urnComponent, options);
      }
      const uriComponent = urnComponent;
      const nss = urnComponent.nss;
      uriComponent.path = `${nid || options.nid}:${nss}`;
      options.skipEscape = true;
      return uriComponent;
    }
    function urnuuidParse(urnComponent, options) {
      const uuidComponent = urnComponent;
      uuidComponent.uuid = uuidComponent.nss;
      uuidComponent.nss = void 0;
      if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
        uuidComponent.error = uuidComponent.error || "UUID is not valid.";
      }
      return uuidComponent;
    }
    function urnuuidSerialize(uuidComponent) {
      const urnComponent = uuidComponent;
      urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
      return urnComponent;
    }
    var http = (
      /** @type {SchemeHandler} */
      {
        scheme: "http",
        domainHost: true,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var https = (
      /** @type {SchemeHandler} */
      {
        scheme: "https",
        domainHost: http.domainHost,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var ws = (
      /** @type {SchemeHandler} */
      {
        scheme: "ws",
        domainHost: true,
        parse: wsParse,
        serialize: wsSerialize
      }
    );
    var wss = (
      /** @type {SchemeHandler} */
      {
        scheme: "wss",
        domainHost: ws.domainHost,
        parse: ws.parse,
        serialize: ws.serialize
      }
    );
    var urn = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn",
        parse: urnParse,
        serialize: urnSerialize,
        skipNormalize: true
      }
    );
    var urnuuid = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn:uuid",
        parse: urnuuidParse,
        serialize: urnuuidSerialize,
        skipNormalize: true
      }
    );
    var SCHEMES = (
      /** @type {Record<SchemeName, SchemeHandler>} */
      {
        http,
        https,
        ws,
        wss,
        urn,
        "urn:uuid": urnuuid
      }
    );
    Object.setPrototypeOf(SCHEMES, null);
    function getSchemeHandler(scheme) {
      return scheme && (SCHEMES[
        /** @type {SchemeName} */
        scheme
      ] || SCHEMES[
        /** @type {SchemeName} */
        scheme.toLowerCase()
      ]) || void 0;
    }
    module.exports = {
      wsIsSecure,
      SCHEMES,
      isValidSchemeName,
      getSchemeHandler
    };
  }
});

// node_modules/fast-uri/index.js
var require_fast_uri = __commonJS({
  "node_modules/fast-uri/index.js"(exports, module) {
    "use strict";
    var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, serializePathEncoding, normalizeQueryFragmentEncoding, encodeQuery, encodeFragment, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
    var { SCHEMES, getSchemeHandler } = require_schemes();
    var VALID_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
    var MALFORMED_SCHEME_ERROR = "URI scheme is malformed.";
    function decodeValidScheme(scheme) {
      const decodedScheme = unescape(String(scheme));
      if (!VALID_SCHEME.test(decodedScheme)) {
        throw new TypeError(MALFORMED_SCHEME_ERROR);
      }
      return decodedScheme;
    }
    function normalize(uri, options) {
      if (typeof uri === "string") {
        uri = /** @type {T} */
        normalizeString(uri, options);
      } else if (typeof uri === "object") {
        uri = /** @type {T} */
        parse2(serialize(uri, options), options);
      }
      return uri;
    }
    function resolve4(baseURI, relativeURI, options) {
      const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
      const {
        parsed: baseParsed,
        malformedAuthorityOrPort: baseMalformed,
        malformedPercentEncoding: baseMalformedPercentEncoding,
        malformedSchemeSpecific: baseMalformedSchemeSpecific,
        malformedHost: baseMalformedHost,
        malformedScheme: baseMalformedScheme
      } = parseWithStatus(baseURI, schemelessOptions);
      const {
        parsed: relativeParsed,
        malformedAuthorityOrPort: relativeMalformed,
        malformedPercentEncoding: relativeMalformedPercentEncoding,
        malformedSchemeSpecific: relativeMalformedSchemeSpecific,
        malformedHost: relativeMalformedHost,
        malformedScheme: relativeMalformedScheme
      } = parseWithStatus(relativeURI, schemelessOptions);
      if (baseMalformed || relativeMalformed || baseMalformedPercentEncoding || relativeMalformedPercentEncoding || baseMalformedSchemeSpecific || relativeMalformedSchemeSpecific || baseMalformedHost || relativeMalformedHost || baseMalformedScheme || relativeMalformedScheme) {
        throw new Error(baseParsed.error || relativeParsed.error || "URI is malformed.");
      }
      const resolved = resolveComponent(baseParsed, relativeParsed, schemelessOptions, true);
      const resolvedSchemeHandler = getSchemeHandler(options && options.scheme || resolved.scheme);
      const resolvedHost = resolved.host;
      const resolvedHostIsIP = resolvedHost !== void 0 && resolvedHost !== "" && (isIPv4(resolvedHost) || normalizeIPv6(resolvedHost).isIPV6);
      canonicalizeHost(resolved, options || {}, resolvedSchemeHandler, resolvedHostIsIP);
      const encodedASCIIHost = resolvedHost && resolvedHost.indexOf("%") !== -1 && !/\P{ASCII}/u.test(resolvedHost);
      if (resolved.error && !encodedASCIIHost) {
        throw new Error(resolved.error);
      }
      schemelessOptions.skipEscape = true;
      return serialize(resolved, schemelessOptions);
    }
    function resolveComponent(base, relative2, options, skipNormalization) {
      const target = {};
      if (!skipNormalization) {
        base = parse2(serialize(base, options), options);
        relative2 = parse2(serialize(relative2, options), options);
      }
      options = options || {};
      if (!options.tolerant && relative2.scheme) {
        target.scheme = relative2.scheme;
        target.userinfo = relative2.userinfo;
        target.host = relative2.host;
        target.port = relative2.port;
        target.path = removeDotSegments(relative2.path || "");
        target.query = relative2.query;
      } else {
        if (relative2.userinfo !== void 0 || relative2.host !== void 0 || relative2.port !== void 0) {
          target.userinfo = relative2.userinfo;
          target.host = relative2.host;
          target.port = relative2.port;
          target.path = removeDotSegments(relative2.path || "");
          target.query = relative2.query;
        } else {
          if (!relative2.path) {
            target.path = base.path;
            if (relative2.query !== void 0) {
              target.query = relative2.query;
            } else {
              target.query = base.query;
            }
          } else {
            if (relative2.path[0] === "/") {
              target.path = removeDotSegments(relative2.path);
            } else {
              if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
                target.path = "/" + relative2.path;
              } else if (!base.path) {
                target.path = relative2.path;
              } else {
                target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative2.path;
              }
              target.path = removeDotSegments(target.path);
            }
            target.query = relative2.query;
          }
          target.userinfo = base.userinfo;
          target.host = base.host;
          target.port = base.port;
        }
        target.scheme = base.scheme;
      }
      target.fragment = relative2.fragment;
      return target;
    }
    function equal(uriA, uriB, options) {
      const normalizedA = normalizeComparableURI(uriA, options);
      const normalizedB = normalizeComparableURI(uriB, options);
      return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA === normalizedB;
    }
    function serialize(cmpts, opts) {
      const component = {
        host: cmpts.host,
        scheme: cmpts.scheme,
        userinfo: cmpts.userinfo,
        port: cmpts.port,
        path: cmpts.path,
        query: cmpts.query,
        nid: cmpts.nid,
        nss: cmpts.nss,
        uuid: cmpts.uuid,
        fragment: cmpts.fragment,
        reference: cmpts.reference,
        resourceName: cmpts.resourceName,
        secure: cmpts.secure,
        error: ""
      };
      const options = Object.assign({}, opts);
      const uriTokens = [];
      if (component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
      }
      const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
      if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
      const hasAuthority = component.userinfo !== void 0 || component.host !== void 0 || component.port !== void 0;
      const pathNoScheme = !options.skipEscape && component.scheme === void 0 && !hasAuthority;
      if (component.path !== void 0) {
        if (!options.skipEscape) {
          component.path = serializePathEncoding(component.path, pathNoScheme);
        } else {
          component.path = normalizePercentEncoding(component.path);
        }
      }
      if (options.reference !== "suffix" && component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
        uriTokens.push(component.scheme, ":");
      }
      const authority = recomposeAuthority(component);
      if (authority !== void 0) {
        if (options.reference !== "suffix") {
          uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (component.path && component.path[0] !== "/") {
          uriTokens.push("/");
        }
      }
      if (component.path !== void 0) {
        let s = component.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
          s = removeDotSegments(s);
        }
        if (pathNoScheme) {
          s = serializePathEncoding(s, true);
        }
        if (authority === void 0 && s[0] === "/" && s[1] === "/") {
          s = "/%2F" + s.slice(2);
        }
        uriTokens.push(s);
      }
      if (component.query !== void 0) {
        uriTokens.push("?", encodeQuery(component.query));
      }
      if (component.fragment !== void 0) {
        uriTokens.push("#", encodeFragment(component.fragment));
      }
      return uriTokens.join("");
    }
    var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
    var AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/;
    var AUTHORITY_INTRODUCER_REGION = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
    function getParseError(parsed, matches) {
      if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/") {
        return 'URI path must start with "/" when authority is present.';
      }
      if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
        return "URI port is malformed.";
      }
      return void 0;
    }
    function hasMalformedPercentEncoding(component) {
      if (component === void 0) return false;
      let percent = component.indexOf("%");
      while (percent !== -1) {
        if (percent + 2 >= component.length || !/^[\da-f]{2}$/iu.test(component.slice(percent + 1, percent + 3))) {
          return true;
        }
        percent = component.indexOf("%", percent + 3);
      }
      return false;
    }
    function isIPLiteral(host) {
      return host[0] === "[" && host[host.length - 1] === "]";
    }
    function hasMalformedComponentPercentEncoding(matches) {
      const host = matches[4];
      return hasMalformedPercentEncoding(matches[3]) || host !== void 0 && !isIPLiteral(host) && hasMalformedPercentEncoding(host) || hasMalformedPercentEncoding(matches[6]) || hasMalformedPercentEncoding(matches[7]) || hasMalformedPercentEncoding(matches[8]);
    }
    function canonicalizeHost(parsed, options, schemeHandler, isIP) {
      if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport) && parsed.host && !isIPLiteral(parsed.host) && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
        try {
          parsed.host = new URL("http://" + parsed.host).hostname;
        } catch (e) {
          parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
          return true;
        }
      }
      return false;
    }
    function parseWithStatus(uri, opts) {
      const options = Object.assign({}, opts);
      const parsed = {
        scheme: void 0,
        userinfo: void 0,
        host: "",
        port: void 0,
        path: "",
        query: void 0,
        fragment: void 0
      };
      let malformedAuthorityOrPort = false;
      let malformedPercentEncoding = false;
      let malformedSchemeSpecific = false;
      let malformedHost = false;
      let malformedIPLiteral = false;
      let malformedScheme = false;
      let isIP = false;
      if (options.reference === "suffix") {
        if (options.scheme) {
          uri = options.scheme + ":" + uri;
        } else {
          uri = "//" + uri;
        }
      }
      const authorityMatch = uri.match(AUTHORITY_PREFIX);
      if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1) {
        parsed.error = "URI authority must not contain a literal backslash.";
        malformedAuthorityOrPort = true;
      }
      const introducerMatch = uri.match(AUTHORITY_INTRODUCER_REGION);
      if (introducerMatch !== null) {
        const region = introducerMatch[1];
        const normalizedRegion = region.replace(/[\t\n\r]/g, "");
        if (normalizedRegion.length >= 2) {
          if (normalizedRegion.slice(0, 2) !== "//") {
            parsed.error = parsed.error || "URI authority must not contain a literal backslash.";
            malformedAuthorityOrPort = true;
          } else if (region.length !== normalizedRegion.length) {
            parsed.error = parsed.error || "URI authority introducer must not contain whitespace.";
            malformedAuthorityOrPort = true;
          }
        }
      }
      const matches = uri.match(URI_PARSE);
      if (matches) {
        parsed.scheme = matches[1];
        parsed.userinfo = matches[3];
        parsed.host = matches[4];
        parsed.port = parseInt(matches[5], 10);
        parsed.path = matches[6] || "";
        parsed.query = matches[7];
        parsed.fragment = matches[8];
        if (parsed.scheme !== void 0) {
          const decodedScheme = unescape(parsed.scheme);
          if (VALID_SCHEME.test(decodedScheme)) {
            parsed.scheme = decodedScheme.toLowerCase();
          } else {
            parsed.error = parsed.error || MALFORMED_SCHEME_ERROR;
            malformedScheme = true;
          }
        }
        malformedPercentEncoding = hasMalformedComponentPercentEncoding(matches);
        if (malformedPercentEncoding) {
          parsed.error = parsed.error || "URI contains malformed percent-encoding.";
        }
        if (isNaN(parsed.port)) {
          parsed.port = matches[5];
        }
        const parseError = getParseError(parsed, matches);
        if (parseError !== void 0) {
          parsed.error = parsed.error || parseError;
          malformedAuthorityOrPort = true;
        }
        if (parsed.host) {
          const ipv4result = isIPv4(parsed.host);
          if (ipv4result === false) {
            const bracketedIPLiteral = isIPLiteral(parsed.host);
            const hasIPLiteralBracket = parsed.host.indexOf("[") !== -1 || parsed.host.indexOf("]") !== -1;
            const ipv6result = normalizeIPv6(parsed.host);
            isIP = ipv6result.isIPV6 || ipv6result.isIPVFuture === true;
            malformedIPLiteral = hasIPLiteralBracket && (!bracketedIPLiteral || ipv6result.error === true);
            parsed.host = isIP ? ipv6result.host : ipv6result.host.toLowerCase();
            if (malformedIPLiteral) {
              parsed.error = parsed.error || "URI host is malformed.";
              malformedAuthorityOrPort = true;
            }
          } else {
            isIP = true;
          }
        }
        if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
          parsed.reference = "same-document";
        } else if (parsed.scheme === void 0) {
          parsed.reference = "relative";
        } else if (parsed.fragment === void 0) {
          parsed.reference = "absolute";
        } else {
          parsed.reference = "uri";
        }
        if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
          parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
        }
        const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
        if (!malformedIPLiteral) {
          malformedHost = canonicalizeHost(parsed, options, schemeHandler, isIP);
        }
        if (uri.indexOf("%") !== -1 && parsed.host !== void 0 && !malformedIPLiteral) {
          let host = isIP ? parsed.host : normalizePercentEncoding(parsed.host, true);
          if (!isIP) {
            host = normalizePercentEncoding(host.toLowerCase());
          }
          parsed.host = reescapeHostDelimiters(host, isIP);
        }
        if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
          if (parsed.path) {
            parsed.path = normalizePathEncoding(parsed.path);
          }
          if (parsed.query) {
            parsed.query = normalizeQueryFragmentEncoding(parsed.query);
          }
          if (parsed.fragment) {
            parsed.fragment = normalizeQueryFragmentEncoding(parsed.fragment);
          }
        }
        if (schemeHandler && schemeHandler.parse) {
          schemeHandler.parse(parsed, options);
          if (schemeHandler === SCHEMES.urn && parsed.nid === void 0) {
            malformedSchemeSpecific = true;
          }
        }
      } else {
        parsed.error = parsed.error || "URI can not be parsed.";
      }
      return { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme };
    }
    function parse2(uri, opts) {
      return parseWithStatus(uri, opts).parsed;
    }
    function normalizeString(uri, opts) {
      return normalizeStringWithStatus(uri, opts).normalized;
    }
    function normalizeStringWithStatus(uri, opts) {
      const { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = parseWithStatus(uri, opts);
      return {
        normalized: malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? uri : serialize(parsed, opts),
        malformedAuthorityOrPort,
        malformedPercentEncoding,
        malformedSchemeSpecific,
        malformedHost,
        malformedScheme
      };
    }
    function normalizeComparableURI(uri, opts) {
      if (typeof uri !== "string" && typeof uri !== "object") {
        return void 0;
      }
      let value;
      try {
        value = typeof uri === "string" ? uri : serialize(uri, opts);
      } catch {
        return void 0;
      }
      const { normalized, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = normalizeStringWithStatus(value, opts);
      return malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? void 0 : normalized;
    }
    var fastUri = {
      SCHEMES,
      normalize,
      resolve: resolve4,
      resolveComponent,
      equal,
      serialize,
      parse: parse2
    };
    module.exports = fastUri;
    module.exports.default = fastUri;
    module.exports.fastUri = fastUri;
  }
});

// node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS({
  "node_modules/ajv/dist/runtime/uri.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var uri = require_fast_uri();
    uri.code = 'require("ajv/dist/runtime/uri").default';
    exports.default = uri;
  }
});

// node_modules/ajv/dist/core.js
var require_core = __commonJS({
  "node_modules/ajv/dist/core.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = void 0;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    var ref_error_1 = require_ref_error();
    var rules_1 = require_rules();
    var compile_1 = require_compile();
    var codegen_2 = require_codegen();
    var resolve_1 = require_resolve();
    var dataType_1 = require_dataType();
    var util_1 = require_util();
    var $dataRefSchema = require_data();
    var uri_1 = require_uri();
    var defaultRegExp = (str, flags) => new RegExp(str, flags);
    defaultRegExp.code = "new RegExp";
    var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
    var EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
      "validate",
      "serialize",
      "parse",
      "wrapper",
      "root",
      "schema",
      "keyword",
      "pattern",
      "formats",
      "validate$data",
      "func",
      "obj",
      "Error"
    ]);
    var removedOptions = {
      errorDataPath: "",
      format: "`validateFormats: false` can be used instead.",
      nullable: '"nullable" keyword is supported by default.',
      jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
      extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
      missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
      processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
      sourceCode: "Use option `code: {source: true}`",
      strictDefaults: "It is default now, see option `strict`.",
      strictKeywords: "It is default now, see option `strict`.",
      uniqueItems: '"uniqueItems" keyword is always validated.',
      unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
      cache: "Map is used as cache, schema object as key.",
      serialize: "Map is used as cache, schema object as key.",
      ajvErrors: "It is default now."
    };
    var deprecatedOptions = {
      ignoreKeywordsWithRef: "",
      jsPropertySyntax: "",
      unicode: '"minLength"/"maxLength" account for unicode characters by default.'
    };
    var MAX_EXPRESSION = 200;
    function requiredOptions(o) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
      const s = o.strict;
      const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
      const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
      const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
      const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
      return {
        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
        uriResolver
      };
    }
    var Ajv2 = class {
      constructor(opts = {}) {
        this.schemas = {};
        this.refs = {};
        this.formats = /* @__PURE__ */ Object.create(null);
        this._compilations = /* @__PURE__ */ new Set();
        this._loading = {};
        this._cache = /* @__PURE__ */ new Map();
        opts = this.opts = { ...opts, ...requiredOptions(opts) };
        const { es5, lines } = this.opts.code;
        this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
        this.logger = getLogger(opts.logger);
        const formatOpt = opts.validateFormats;
        opts.validateFormats = false;
        this.RULES = (0, rules_1.getRules)();
        checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
        checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
        this._metaOpts = getMetaSchemaOptions.call(this);
        if (opts.formats)
          addInitialFormats.call(this);
        this._addVocabularies();
        this._addDefaultMetaSchema();
        if (opts.keywords)
          addInitialKeywords.call(this, opts.keywords);
        if (typeof opts.meta == "object")
          this.addMetaSchema(opts.meta);
        addInitialSchemas.call(this);
        opts.validateFormats = formatOpt;
      }
      _addVocabularies() {
        this.addKeyword("$async");
      }
      _addDefaultMetaSchema() {
        const { $data, meta, schemaId } = this.opts;
        let _dataRefSchema = $dataRefSchema;
        if (schemaId === "id") {
          _dataRefSchema = { ...$dataRefSchema };
          _dataRefSchema.id = _dataRefSchema.$id;
          delete _dataRefSchema.$id;
        }
        if (meta && $data)
          this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
      }
      defaultMeta() {
        const { meta, schemaId } = this.opts;
        return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
      }
      validate(schemaKeyRef, data) {
        let v;
        if (typeof schemaKeyRef == "string") {
          v = this.getSchema(schemaKeyRef);
          if (!v)
            throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
        } else {
          v = this.compile(schemaKeyRef);
        }
        const valid = v(data);
        if (!("$async" in v))
          this.errors = v.errors;
        return valid;
      }
      compile(schema, _meta) {
        const sch = this._addSchema(schema, _meta);
        return sch.validate || this._compileSchemaEnv(sch);
      }
      compileAsync(schema, meta) {
        if (typeof this.opts.loadSchema != "function") {
          throw new Error("options.loadSchema should be a function");
        }
        const { loadSchema } = this.opts;
        return runCompileAsync.call(this, schema, meta);
        async function runCompileAsync(_schema, _meta) {
          await loadMetaSchema.call(this, _schema.$schema);
          const sch = this._addSchema(_schema, _meta);
          return sch.validate || _compileAsync.call(this, sch);
        }
        async function loadMetaSchema($ref) {
          if ($ref && !this.getSchema($ref)) {
            await runCompileAsync.call(this, { $ref }, true);
          }
        }
        async function _compileAsync(sch) {
          try {
            return this._compileSchemaEnv(sch);
          } catch (e) {
            if (!(e instanceof ref_error_1.default))
              throw e;
            checkLoaded.call(this, e);
            await loadMissingSchema.call(this, e.missingSchema);
            return _compileAsync.call(this, sch);
          }
        }
        function checkLoaded({ missingSchema: ref, missingRef }) {
          if (this.refs[ref]) {
            throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
          }
        }
        async function loadMissingSchema(ref) {
          const _schema = await _loadSchema.call(this, ref);
          if (!this.refs[ref])
            await loadMetaSchema.call(this, _schema.$schema);
          if (!this.refs[ref])
            this.addSchema(_schema, ref, meta);
        }
        async function _loadSchema(ref) {
          const p = this._loading[ref];
          if (p)
            return p;
          try {
            return await (this._loading[ref] = loadSchema(ref));
          } finally {
            delete this._loading[ref];
          }
        }
      }
      // Adds schema to the instance
      addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
        if (Array.isArray(schema)) {
          for (const sch of schema)
            this.addSchema(sch, void 0, _meta, _validateSchema);
          return this;
        }
        let id;
        if (typeof schema === "object") {
          const { schemaId } = this.opts;
          id = schema[schemaId];
          if (id !== void 0 && typeof id != "string") {
            throw new Error(`schema ${schemaId} must be string`);
          }
        }
        key = (0, resolve_1.normalizeId)(key || id);
        this._checkUnique(key);
        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
        return this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
        this.addSchema(schema, key, true, _validateSchema);
        return this;
      }
      //  Validate schema against its meta-schema
      validateSchema(schema, throwOrLogError) {
        if (typeof schema == "boolean")
          return true;
        let $schema;
        $schema = schema.$schema;
        if ($schema !== void 0 && typeof $schema != "string") {
          throw new Error("$schema must be a string");
        }
        $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
        if (!$schema) {
          this.logger.warn("meta-schema not available");
          this.errors = null;
          return true;
        }
        const valid = this.validate($schema, schema);
        if (!valid && throwOrLogError) {
          const message = "schema is invalid: " + this.errorsText();
          if (this.opts.validateSchema === "log")
            this.logger.error(message);
          else
            throw new Error(message);
        }
        return valid;
      }
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(keyRef) {
        let sch;
        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
          keyRef = sch;
        if (sch === void 0) {
          const { schemaId } = this.opts;
          const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
          sch = compile_1.resolveSchema.call(this, root, keyRef);
          if (!sch)
            return;
          this.refs[keyRef] = sch;
        }
        return sch.validate || this._compileSchemaEnv(sch);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
      removeSchema(schemaKeyRef) {
        if (schemaKeyRef instanceof RegExp) {
          this._removeAllSchemas(this.schemas, schemaKeyRef);
          this._removeAllSchemas(this.refs, schemaKeyRef);
          return this;
        }
        switch (typeof schemaKeyRef) {
          case "undefined":
            this._removeAllSchemas(this.schemas);
            this._removeAllSchemas(this.refs);
            this._cache.clear();
            return this;
          case "string": {
            const sch = getSchEnv.call(this, schemaKeyRef);
            if (typeof sch == "object")
              this._cache.delete(sch.schema);
            delete this.schemas[schemaKeyRef];
            delete this.refs[schemaKeyRef];
            return this;
          }
          case "object": {
            const cacheKey = schemaKeyRef;
            this._cache.delete(cacheKey);
            let id = schemaKeyRef[this.opts.schemaId];
            if (id) {
              id = (0, resolve_1.normalizeId)(id);
              delete this.schemas[id];
              delete this.refs[id];
            }
            return this;
          }
          default:
            throw new Error("ajv.removeSchema: invalid parameter");
        }
      }
      // add "vocabulary" - a collection of keywords
      addVocabulary(definitions) {
        for (const def2 of definitions)
          this.addKeyword(def2);
        return this;
      }
      addKeyword(kwdOrDef, def2) {
        let keyword;
        if (typeof kwdOrDef == "string") {
          keyword = kwdOrDef;
          if (typeof def2 == "object") {
            this.logger.warn("these parameters are deprecated, see docs for addKeyword");
            def2.keyword = keyword;
          }
        } else if (typeof kwdOrDef == "object" && def2 === void 0) {
          def2 = kwdOrDef;
          keyword = def2.keyword;
          if (Array.isArray(keyword) && !keyword.length) {
            throw new Error("addKeywords: keyword must be string or non-empty array");
          }
        } else {
          throw new Error("invalid addKeywords parameters");
        }
        checkKeyword.call(this, keyword, def2);
        if (!def2) {
          (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
          return this;
        }
        keywordMetaschema.call(this, def2);
        const definition = {
          ...def2,
          type: (0, dataType_1.getJSONTypes)(def2.type),
          schemaType: (0, dataType_1.getJSONTypes)(def2.schemaType)
        };
        (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
        return this;
      }
      getKeyword(keyword) {
        const rule = this.RULES.all[keyword];
        return typeof rule == "object" ? rule.definition : !!rule;
      }
      // Remove keyword
      removeKeyword(keyword) {
        const { RULES } = this;
        delete RULES.keywords[keyword];
        delete RULES.all[keyword];
        for (const group of RULES.rules) {
          const i = group.rules.findIndex((rule) => rule.keyword === keyword);
          if (i >= 0)
            group.rules.splice(i, 1);
        }
        return this;
      }
      // Add format
      addFormat(name, format) {
        if (typeof format == "string")
          format = new RegExp(format);
        this.formats[name] = format;
        return this;
      }
      errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
        if (!errors || errors.length === 0)
          return "No errors";
        return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
      }
      $dataMetaSchema(metaSchema, keywordsJsonPointers) {
        const rules = this.RULES.all;
        metaSchema = JSON.parse(JSON.stringify(metaSchema));
        for (const jsonPointer of keywordsJsonPointers) {
          const segments = jsonPointer.split("/").slice(1);
          let keywords = metaSchema;
          for (const seg of segments)
            keywords = keywords[seg];
          for (const key in rules) {
            const rule = rules[key];
            if (typeof rule != "object")
              continue;
            const { $data } = rule.definition;
            const schema = keywords[key];
            if ($data && schema)
              keywords[key] = schemaOrData(schema);
          }
        }
        return metaSchema;
      }
      _removeAllSchemas(schemas, regex) {
        for (const keyRef in schemas) {
          const sch = schemas[keyRef];
          if (!regex || regex.test(keyRef)) {
            if (typeof sch == "string") {
              delete schemas[keyRef];
            } else if (sch && !sch.meta) {
              this._cache.delete(sch.schema);
              delete schemas[keyRef];
            }
          }
        }
      }
      _addSchema(schema, meta, baseId, validateSchema2 = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
        let id;
        const { schemaId } = this.opts;
        if (typeof schema == "object") {
          id = schema[schemaId];
        } else {
          if (this.opts.jtd)
            throw new Error("schema must be object");
          else if (typeof schema != "boolean")
            throw new Error("schema must be object or boolean");
        }
        let sch = this._cache.get(schema);
        if (sch !== void 0)
          return sch;
        baseId = (0, resolve_1.normalizeId)(id || baseId);
        const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
        sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
        this._cache.set(sch.schema, sch);
        if (addSchema && !baseId.startsWith("#")) {
          if (baseId)
            this._checkUnique(baseId);
          this.refs[baseId] = sch;
        }
        if (validateSchema2)
          this.validateSchema(schema, true);
        return sch;
      }
      _checkUnique(id) {
        if (this.schemas[id] || this.refs[id]) {
          throw new Error(`schema with key or id "${id}" already exists`);
        }
      }
      _compileSchemaEnv(sch) {
        if (sch.meta)
          this._compileMetaSchema(sch);
        else
          compile_1.compileSchema.call(this, sch);
        if (!sch.validate)
          throw new Error("ajv implementation error");
        return sch.validate;
      }
      _compileMetaSchema(sch) {
        const currentOpts = this.opts;
        this.opts = this._metaOpts;
        try {
          compile_1.compileSchema.call(this, sch);
        } finally {
          this.opts = currentOpts;
        }
      }
    };
    Ajv2.ValidationError = validation_error_1.default;
    Ajv2.MissingRefError = ref_error_1.default;
    exports.default = Ajv2;
    function checkOptions(checkOpts, options, msg, log = "error") {
      for (const key in checkOpts) {
        const opt = key;
        if (opt in options)
          this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
      }
    }
    function getSchEnv(keyRef) {
      keyRef = (0, resolve_1.normalizeId)(keyRef);
      return this.schemas[keyRef] || this.refs[keyRef];
    }
    function addInitialSchemas() {
      const optsSchemas = this.opts.schemas;
      if (!optsSchemas)
        return;
      if (Array.isArray(optsSchemas))
        this.addSchema(optsSchemas);
      else
        for (const key in optsSchemas)
          this.addSchema(optsSchemas[key], key);
    }
    function addInitialFormats() {
      for (const name in this.opts.formats) {
        const format = this.opts.formats[name];
        if (format)
          this.addFormat(name, format);
      }
    }
    function addInitialKeywords(defs) {
      if (Array.isArray(defs)) {
        this.addVocabulary(defs);
        return;
      }
      this.logger.warn("keywords option as map is deprecated, pass array");
      for (const keyword in defs) {
        const def2 = defs[keyword];
        if (!def2.keyword)
          def2.keyword = keyword;
        this.addKeyword(def2);
      }
    }
    function getMetaSchemaOptions() {
      const metaOpts = { ...this.opts };
      for (const opt of META_IGNORE_OPTIONS)
        delete metaOpts[opt];
      return metaOpts;
    }
    var noLogs = { log() {
    }, warn() {
    }, error() {
    } };
    function getLogger(logger) {
      if (logger === false)
        return noLogs;
      if (logger === void 0)
        return console;
      if (logger.log && logger.warn && logger.error)
        return logger;
      throw new Error("logger must implement log, warn and error methods");
    }
    var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
    function checkKeyword(keyword, def2) {
      const { RULES } = this;
      (0, util_1.eachItem)(keyword, (kwd) => {
        if (RULES.keywords[kwd])
          throw new Error(`Keyword ${kwd} is already defined`);
        if (!KEYWORD_NAME.test(kwd))
          throw new Error(`Keyword ${kwd} has invalid name`);
      });
      if (!def2)
        return;
      if (def2.$data && !("code" in def2 || "validate" in def2)) {
        throw new Error('$data keyword must have "code" or "validate" function');
      }
    }
    function addRule(keyword, definition, dataType) {
      var _a;
      const post = definition === null || definition === void 0 ? void 0 : definition.post;
      if (dataType && post)
        throw new Error('keyword with "post" flag cannot have "type"');
      const { RULES } = this;
      let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
      if (!ruleGroup) {
        ruleGroup = { type: dataType, rules: [] };
        RULES.rules.push(ruleGroup);
      }
      RULES.keywords[keyword] = true;
      if (!definition)
        return;
      const rule = {
        keyword,
        definition: {
          ...definition,
          type: (0, dataType_1.getJSONTypes)(definition.type),
          schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
        }
      };
      if (definition.before)
        addBeforeRule.call(this, ruleGroup, rule, definition.before);
      else
        ruleGroup.rules.push(rule);
      RULES.all[keyword] = rule;
      (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
    }
    function addBeforeRule(ruleGroup, rule, before) {
      const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
      if (i >= 0) {
        ruleGroup.rules.splice(i, 0, rule);
      } else {
        ruleGroup.rules.push(rule);
        this.logger.warn(`rule ${before} is not defined`);
      }
    }
    function keywordMetaschema(def2) {
      let { metaSchema } = def2;
      if (metaSchema === void 0)
        return;
      if (def2.$data && this.opts.$data)
        metaSchema = schemaOrData(metaSchema);
      def2.validateSchema = this.compile(metaSchema, true);
    }
    var $dataRef = {
      $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
    };
    function schemaOrData(schema) {
      return { anyOf: [schema, $dataRef] };
    }
  }
});

// node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/id.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var def2 = {
      keyword: "id",
      code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/ref.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.callRef = exports.getValidate = void 0;
    var ref_error_1 = require_ref_error();
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var compile_1 = require_compile();
    var util_1 = require_util();
    var def2 = {
      keyword: "$ref",
      schemaType: "string",
      code(cxt) {
        const { gen, schema: $ref, it } = cxt;
        const { baseId, schemaEnv: env, validateName, opts, self: self2 } = it;
        const { root } = env;
        if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
          return callRootRef();
        const schOrEnv = compile_1.resolveRef.call(self2, root, baseId, $ref);
        if (schOrEnv === void 0)
          throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
        if (schOrEnv instanceof compile_1.SchemaEnv)
          return callValidate(schOrEnv);
        return inlineRefSchema(schOrEnv);
        function callRootRef() {
          if (env === root)
            return callRef(cxt, validateName, env, env.$async);
          const rootName = gen.scopeValue("root", { ref: root });
          return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
        }
        function callValidate(sch) {
          const v = getValidate(cxt, sch);
          callRef(cxt, v, sch, sch.$async);
        }
        function inlineRefSchema(sch) {
          const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
          const valid = gen.name("valid");
          const schCxt = cxt.subschema({
            schema: sch,
            dataTypes: [],
            schemaPath: codegen_1.nil,
            topSchemaRef: schName,
            errSchemaPath: $ref
          }, valid);
          cxt.mergeEvaluated(schCxt);
          cxt.ok(valid);
        }
      }
    };
    function getValidate(cxt, sch) {
      const { gen } = cxt;
      return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
    }
    exports.getValidate = getValidate;
    function callRef(cxt, v, sch, $async) {
      const { gen, it } = cxt;
      const { allErrors, schemaEnv: env, opts } = it;
      const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
      if ($async)
        callAsyncRef();
      else
        callSyncRef();
      function callAsyncRef() {
        if (!env.$async)
          throw new Error("async schema referenced by sync schema");
        const valid = gen.let("valid");
        gen.try(() => {
          gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
          addEvaluatedFrom(v);
          if (!allErrors)
            gen.assign(valid, true);
        }, (e) => {
          gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
          addErrorsFrom(e);
          if (!allErrors)
            gen.assign(valid, false);
        });
        cxt.ok(valid);
      }
      function callSyncRef() {
        cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
      }
      function addErrorsFrom(source) {
        const errs = (0, codegen_1._)`${source}.errors`;
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
        gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      }
      function addEvaluatedFrom(source) {
        var _a;
        if (!it.opts.unevaluated)
          return;
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        if (it.props !== true) {
          if (schEvaluated && !schEvaluated.dynamicProps) {
            if (schEvaluated.props !== void 0) {
              it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
            }
          } else {
            const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
            it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
          }
        }
        if (it.items !== true) {
          if (schEvaluated && !schEvaluated.dynamicItems) {
            if (schEvaluated.items !== void 0) {
              it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
            }
          } else {
            const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
            it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
          }
        }
      }
    }
    exports.callRef = callRef;
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var id_1 = require_id();
    var ref_1 = require_ref();
    var core = [
      "$schema",
      "$id",
      "$defs",
      "$vocabulary",
      { keyword: "$comment" },
      "definitions",
      id_1.default,
      ref_1.default
    ];
    exports.default = core;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitNumber.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    var def2 = {
      keyword: Object.keys(KWDs),
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/multipleOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
      params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
    };
    var def2 = {
      keyword: "multipleOf",
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, schemaCode, it } = cxt;
        const prec = it.opts.multipleOfPrecision;
        const res = gen.let("res");
        const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
        cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitLength.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var ucs2length_1 = require_ucs2length();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxLength" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def2 = {
      keyword: ["maxLength", "minLength"],
      type: "string",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode, it } = cxt;
        const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
        const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
        cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/pattern.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var util_1 = require_util();
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
    };
    var def2 = {
      keyword: "pattern",
      type: "string",
      schemaType: "string",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const u = it.opts.unicodeRegExp ? "u" : "";
        if ($data) {
          const { regExp } = it.opts.code;
          const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
          const valid = gen.let("valid");
          gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
          cxt.fail$data((0, codegen_1._)`!${valid}`);
        } else {
          const regExp = (0, code_1.usePattern)(cxt, schema);
          cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxProperties" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def2 = {
      keyword: ["maxProperties", "minProperties"],
      type: "object",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/required.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
      params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
    };
    var def2 = {
      keyword: "required",
      type: "object",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, schema, schemaCode, data, $data, it } = cxt;
        const { opts } = it;
        if (!$data && schema.length === 0)
          return;
        const useLoop = schema.length >= opts.loopRequired;
        if (it.allErrors)
          allErrorsMode();
        else
          exitOnErrorMode();
        if (opts.strictRequired) {
          const props = cxt.parentSchema.properties;
          const { definedProperties } = cxt.it;
          for (const requiredKey of schema) {
            if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
              const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
              const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
              (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
            }
          }
        }
        function allErrorsMode() {
          if (useLoop || $data) {
            cxt.block$data(codegen_1.nil, loopAllRequired);
          } else {
            for (const prop of schema) {
              (0, code_1.checkReportMissingProp)(cxt, prop);
            }
          }
        }
        function exitOnErrorMode() {
          const missing = gen.let("missing");
          if (useLoop || $data) {
            const valid = gen.let("valid", true);
            cxt.block$data(valid, () => loopUntilMissing(missing, valid));
            cxt.ok(valid);
          } else {
            gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
            (0, code_1.reportMissingProp)(cxt, missing);
            gen.else();
          }
        }
        function loopAllRequired() {
          gen.forOf("prop", schemaCode, (prop) => {
            cxt.setParams({ missingProperty: prop });
            gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
          });
        }
        function loopUntilMissing(missing, valid) {
          cxt.setParams({ missingProperty: missing });
          gen.forOf(missing, schemaCode, () => {
            gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.error();
              gen.break();
            });
          }, codegen_1.nil);
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxItems" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def2 = {
      keyword: ["maxItems", "minItems"],
      type: "array",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports.default = equal;
  }
});

// node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var dataType_1 = require_dataType();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
      params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
    };
    var def2 = {
      keyword: "uniqueItems",
      type: "array",
      schemaType: "boolean",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
        if (!$data && !schema)
          return;
        const valid = gen.let("valid");
        const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
        cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
        cxt.ok(valid);
        function validateUniqueItems() {
          const i = gen.let("i", (0, codegen_1._)`${data}.length`);
          const j = gen.let("j");
          cxt.setParams({ i, j });
          gen.assign(valid, true);
          gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
        }
        function canOptimize() {
          return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
        }
        function loopN(i, j) {
          const item = gen.name("item");
          const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
          const indices = gen.const("indices", (0, codegen_1._)`{}`);
          gen.for((0, codegen_1._)`;${i}--;`, () => {
            gen.let(item, (0, codegen_1._)`${data}[${i}]`);
            gen.if(wrongType, (0, codegen_1._)`continue`);
            if (itemTypes.length > 1)
              gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
            gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
              gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
              cxt.error();
              gen.assign(valid, false).break();
            }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
          });
        }
        function loopN2(i, j) {
          const eql = (0, util_1.useFunc)(gen, equal_1.default);
          const outer = gen.name("outer");
          gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
            cxt.error();
            gen.assign(valid, false).break(outer);
          })));
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/const.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to constant",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
    };
    var def2 = {
      keyword: "const",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schemaCode, schema } = cxt;
        if ($data || schema && typeof schema == "object") {
          cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
        } else {
          cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/enum.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to one of the allowed values",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
    };
    var def2 = {
      keyword: "enum",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        if (!$data && schema.length === 0)
          throw new Error("enum must have non-empty array");
        const useLoop = schema.length >= it.opts.loopEnum;
        let eql;
        const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
        let valid;
        if (useLoop || $data) {
          valid = gen.let("valid");
          cxt.block$data(valid, loopEnum);
        } else {
          if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
          const vSchema = gen.const("vSchema", schemaCode);
          valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
        }
        cxt.pass(valid);
        function loopEnum() {
          gen.assign(valid, false);
          gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
        }
        function equalCode(vSchema, i) {
          const sch = schema[i];
          return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var limitNumber_1 = require_limitNumber();
    var multipleOf_1 = require_multipleOf();
    var limitLength_1 = require_limitLength();
    var pattern_1 = require_pattern();
    var limitProperties_1 = require_limitProperties();
    var required_1 = require_required();
    var limitItems_1 = require_limitItems();
    var uniqueItems_1 = require_uniqueItems();
    var const_1 = require_const();
    var enum_1 = require_enum();
    var validation = [
      // number
      limitNumber_1.default,
      multipleOf_1.default,
      // string
      limitLength_1.default,
      pattern_1.default,
      // object
      limitProperties_1.default,
      required_1.default,
      // array
      limitItems_1.default,
      uniqueItems_1.default,
      // any
      { keyword: "type", schemaType: ["string", "array"] },
      { keyword: "nullable", schemaType: "boolean" },
      const_1.default,
      enum_1.default
    ];
    exports.default = validation;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateAdditionalItems = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def2 = {
      keyword: "additionalItems",
      type: "array",
      schemaType: ["boolean", "object"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { parentSchema, it } = cxt;
        const { items } = parentSchema;
        if (!Array.isArray(items)) {
          (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
          return;
        }
        validateAdditionalItems(cxt, items);
      }
    };
    function validateAdditionalItems(cxt, items) {
      const { gen, schema, data, keyword, it } = cxt;
      it.items = true;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items.length });
        cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
        cxt.ok(valid);
      }
      function validateItems(valid) {
        gen.forRange("i", items.length, len, (i) => {
          cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
    exports.validateAdditionalItems = validateAdditionalItems;
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateTuple = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var def2 = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "array", "boolean"],
      before: "uniqueItems",
      code(cxt) {
        const { schema, it } = cxt;
        if (Array.isArray(schema))
          return validateTuple(cxt, "additionalItems", schema);
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    function validateTuple(cxt, extraItems, schArr = cxt.schema) {
      const { gen, parentSchema, data, keyword, it } = cxt;
      checkStrictTuple(parentSchema);
      if (it.opts.unevaluated && schArr.length && it.items !== true) {
        it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
      }
      const valid = gen.name("valid");
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      schArr.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
          keyword,
          schemaProp: i,
          dataProp: i
        }, valid));
        cxt.ok(valid);
      });
      function checkStrictTuple(sch) {
        const { opts, errSchemaPath } = it;
        const l = schArr.length;
        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
        if (opts.strictTuples && !fullTuple) {
          const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
          (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
        }
      }
    }
    exports.validateTuple = validateTuple;
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/prefixItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var items_1 = require_items();
    var def2 = {
      keyword: "prefixItems",
      type: "array",
      schemaType: ["array"],
      before: "uniqueItems",
      code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items2020.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var additionalItems_1 = require_additionalItems();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def2 = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { schema, parentSchema, it } = cxt;
        const { prefixItems } = parentSchema;
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        if (prefixItems)
          (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
        else
          cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/contains.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
      params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
    };
    var def2 = {
      keyword: "contains",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        let min;
        let max;
        const { minContains, maxContains } = parentSchema;
        if (it.opts.next) {
          min = minContains === void 0 ? 1 : minContains;
          max = maxContains;
        } else {
          min = 1;
        }
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        cxt.setParams({ min, max });
        if (max === void 0 && min === 0) {
          (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
          return;
        }
        if (max !== void 0 && min > max) {
          (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
          cxt.fail();
          return;
        }
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          let cond = (0, codegen_1._)`${len} >= ${min}`;
          if (max !== void 0)
            cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
          cxt.pass(cond);
          return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === void 0 && min === 1) {
          validateItems(valid, () => gen.if(valid, () => gen.break()));
        } else if (min === 0) {
          gen.let(valid, true);
          if (max !== void 0)
            gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
        } else {
          gen.let(valid, false);
          validateItemsWithCount();
        }
        cxt.result(valid, () => cxt.reset());
        function validateItemsWithCount() {
          const schValid = gen.name("_valid");
          const count = gen.let("count", 0);
          validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
        }
        function validateItems(_valid, block) {
          gen.forRange("i", 0, len, (i) => {
            cxt.subschema({
              keyword: "contains",
              dataProp: i,
              dataPropType: util_1.Type.Num,
              compositeRule: true
            }, _valid);
            block();
          });
        }
        function checkLimits(count) {
          gen.code((0, codegen_1._)`${count}++`);
          if (max === void 0) {
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
          } else {
            gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
            if (min === 1)
              gen.assign(valid, true);
            else
              gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
          }
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/dependencies.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    exports.error = {
      message: ({ params: { property, depsCount, deps } }) => {
        const property_ies = depsCount === 1 ? "property" : "properties";
        return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
      },
      params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
      // TODO change to reference
    };
    var def2 = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: exports.error,
      code(cxt) {
        const [propDeps, schDeps] = splitDependencies(cxt);
        validatePropertyDeps(cxt, propDeps);
        validateSchemaDeps(cxt, schDeps);
      }
    };
    function splitDependencies({ schema }) {
      const propertyDeps = {};
      const schemaDeps = {};
      for (const key in schema) {
        if (key === "__proto__")
          continue;
        const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
        deps[key] = schema[key];
      }
      return [propertyDeps, schemaDeps];
    }
    function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
      const { gen, data, it } = cxt;
      if (Object.keys(propertyDeps).length === 0)
        return;
      const missing = gen.let("missing");
      for (const prop in propertyDeps) {
        const deps = propertyDeps[prop];
        if (deps.length === 0)
          continue;
        const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
        cxt.setParams({
          property: prop,
          depsCount: deps.length,
          deps: deps.join(", ")
        });
        if (it.allErrors) {
          gen.if(hasProperty, () => {
            for (const depProp of deps) {
              (0, code_1.checkReportMissingProp)(cxt, depProp);
            }
          });
        } else {
          gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
    }
    exports.validatePropertyDeps = validatePropertyDeps;
    function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      for (const prop in schemaDeps) {
        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
          continue;
        gen.if(
          (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties),
          () => {
            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
            cxt.mergeValidEvaluated(schCxt, valid);
          },
          () => gen.var(valid, true)
          // TODO var
        );
        cxt.ok(valid);
      }
    }
    exports.validateSchemaDeps = validateSchemaDeps;
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/propertyNames.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "property name must be valid",
      params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
    };
    var def2 = {
      keyword: "propertyNames",
      type: "object",
      schemaType: ["object", "boolean"],
      error,
      code(cxt) {
        const { gen, schema, data, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        const valid = gen.name("valid");
        gen.forIn("key", data, (key) => {
          cxt.setParams({ propertyName: key });
          cxt.subschema({
            keyword: "propertyNames",
            data: key,
            dataTypes: ["string"],
            propertyName: key,
            compositeRule: true
          }, valid);
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error(true);
            if (!it.allErrors)
              gen.break();
          });
        });
        cxt.ok(valid);
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var util_1 = require_util();
    var error = {
      message: "must NOT have additional properties",
      params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
    };
    var def2 = {
      keyword: "additionalProperties",
      type: ["object"],
      schemaType: ["boolean", "object"],
      allowUndefined: true,
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, errsCount, it } = cxt;
        if (!errsCount)
          throw new Error("ajv implementation error");
        const { allErrors, opts } = it;
        it.props = true;
        if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
          return;
        const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
        const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
        checkAdditionalProperties();
        cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
        function checkAdditionalProperties() {
          gen.forIn("key", data, (key) => {
            if (!props.length && !patProps.length)
              additionalPropertyCode(key);
            else
              gen.if(isAdditional(key), () => additionalPropertyCode(key));
          });
        }
        function isAdditional(key) {
          let definedProp;
          if (props.length > 8) {
            const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
            definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
          } else if (props.length) {
            definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
          } else {
            definedProp = codegen_1.nil;
          }
          if (patProps.length) {
            definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
          }
          return (0, codegen_1.not)(definedProp);
        }
        function deleteAdditional(key) {
          gen.code((0, codegen_1._)`delete ${data}[${key}]`);
        }
        function additionalPropertyCode(key) {
          if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
            deleteAdditional(key);
            return;
          }
          if (schema === false) {
            cxt.setParams({ additionalProperty: key });
            cxt.error();
            if (!allErrors)
              gen.break();
            return;
          }
          if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
            const valid = gen.name("valid");
            if (opts.removeAdditional === "failing") {
              applyAdditionalSchema(key, valid, false);
              gen.if((0, codegen_1.not)(valid), () => {
                cxt.reset();
                deleteAdditional(key);
              });
            } else {
              applyAdditionalSchema(key, valid);
              if (!allErrors)
                gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          }
        }
        function applyAdditionalSchema(key, valid, errors) {
          const subschema = {
            keyword: "additionalProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          };
          if (errors === false) {
            Object.assign(subschema, {
              compositeRule: true,
              createErrors: false,
              allErrors: false
            });
          }
          cxt.subschema(subschema, valid);
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/properties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var validate_1 = require_validate();
    var code_1 = require_code2();
    var util_1 = require_util();
    var additionalProperties_1 = require_additionalProperties();
    var def2 = {
      keyword: "properties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
          additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
        }
        const allProps = (0, code_1.allSchemaProperties)(schema);
        for (const prop of allProps) {
          it.definedProperties.add(prop);
        }
        if (it.opts.unevaluated && allProps.length && it.props !== true) {
          it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
        }
        const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
        if (properties.length === 0)
          return;
        const valid = gen.name("valid");
        for (const prop of properties) {
          if (hasDefault(prop)) {
            applyPropertySchema(prop);
          } else {
            gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
            applyPropertySchema(prop);
            if (!it.allErrors)
              gen.else().var(valid, true);
            gen.endIf();
          }
          cxt.it.definedProperties.add(prop);
          cxt.ok(valid);
        }
        function hasDefault(prop) {
          return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
        }
        function applyPropertySchema(prop) {
          cxt.subschema({
            keyword: "properties",
            schemaProp: prop,
            dataProp: prop
          }, valid);
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/patternProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var util_2 = require_util();
    var def2 = {
      keyword: "patternProperties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, data, parentSchema, it } = cxt;
        const { opts } = it;
        const patterns = (0, code_1.allSchemaProperties)(schema);
        const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
        if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
          return;
        }
        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
        const valid = gen.name("valid");
        if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
          it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
        }
        const { props } = it;
        validatePatternProperties();
        function validatePatternProperties() {
          for (const pat of patterns) {
            if (checkProperties)
              checkMatchingProperties(pat);
            if (it.allErrors) {
              validateProperties(pat);
            } else {
              gen.var(valid, true);
              validateProperties(pat);
              gen.if(valid);
            }
          }
        }
        function checkMatchingProperties(pat) {
          for (const prop in checkProperties) {
            if (new RegExp(pat).test(prop)) {
              (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
            }
          }
        }
        function validateProperties(pat) {
          gen.forIn("key", data, (key) => {
            gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
              const alwaysValid = alwaysValidPatterns.includes(pat);
              if (!alwaysValid) {
                cxt.subschema({
                  keyword: "patternProperties",
                  schemaProp: pat,
                  dataProp: key,
                  dataPropType: util_2.Type.Str
                }, valid);
              }
              if (it.opts.unevaluated && props !== true) {
                gen.assign((0, codegen_1._)`${props}[${key}]`, true);
              } else if (!alwaysValid && !it.allErrors) {
                gen.if((0, codegen_1.not)(valid), () => gen.break());
              }
            });
          });
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/not.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def2 = {
      keyword: "not",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      code(cxt) {
        const { gen, schema, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          cxt.fail();
          return;
        }
        const valid = gen.name("valid");
        cxt.subschema({
          keyword: "not",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, valid);
        cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
      },
      error: { message: "must NOT be valid" }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/anyOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var def2 = {
      keyword: "anyOf",
      schemaType: "array",
      trackErrors: true,
      code: code_1.validateUnion,
      error: { message: "must match a schema in anyOf" }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/oneOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "must match exactly one schema in oneOf",
      params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
    };
    var def2 = {
      keyword: "oneOf",
      schemaType: "array",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        if (it.opts.discriminator && parentSchema.discriminator)
          return;
        const schArr = schema;
        const valid = gen.let("valid", false);
        const passing = gen.let("passing", null);
        const schValid = gen.name("_valid");
        cxt.setParams({ passing });
        gen.block(validateOneOf);
        cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
        function validateOneOf() {
          schArr.forEach((sch, i) => {
            let schCxt;
            if ((0, util_1.alwaysValidSchema)(it, sch)) {
              gen.var(schValid, true);
            } else {
              schCxt = cxt.subschema({
                keyword: "oneOf",
                schemaProp: i,
                compositeRule: true
              }, schValid);
            }
            if (i > 0) {
              gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
            }
            gen.if(schValid, () => {
              gen.assign(valid, true);
              gen.assign(passing, i);
              if (schCxt)
                cxt.mergeEvaluated(schCxt, codegen_1.Name);
            });
          });
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/allOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def2 = {
      keyword: "allOf",
      schemaType: "array",
      code(cxt) {
        const { gen, schema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const valid = gen.name("valid");
        schema.forEach((sch, i) => {
          if ((0, util_1.alwaysValidSchema)(it, sch))
            return;
          const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
          cxt.ok(valid);
          cxt.mergeEvaluated(schCxt);
        });
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/if.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
      params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
    };
    var def2 = {
      keyword: "if",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, parentSchema, it } = cxt;
        if (parentSchema.then === void 0 && parentSchema.else === void 0) {
          (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
        }
        const hasThen = hasSchema(it, "then");
        const hasElse = hasSchema(it, "else");
        if (!hasThen && !hasElse)
          return;
        const valid = gen.let("valid", true);
        const schValid = gen.name("_valid");
        validateIf();
        cxt.reset();
        if (hasThen && hasElse) {
          const ifClause = gen.let("ifClause");
          cxt.setParams({ ifClause });
          gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
        } else if (hasThen) {
          gen.if(schValid, validateClause("then"));
        } else {
          gen.if((0, codegen_1.not)(schValid), validateClause("else"));
        }
        cxt.pass(valid, () => cxt.error(true));
        function validateIf() {
          const schCxt = cxt.subschema({
            keyword: "if",
            compositeRule: true,
            createErrors: false,
            allErrors: false
          }, schValid);
          cxt.mergeEvaluated(schCxt);
        }
        function validateClause(keyword, ifClause) {
          return () => {
            const schCxt = cxt.subschema({ keyword }, schValid);
            gen.assign(valid, schValid);
            cxt.mergeValidEvaluated(schCxt, valid);
            if (ifClause)
              gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
            else
              cxt.setParams({ ifClause: keyword });
          };
        }
      }
    };
    function hasSchema(it, keyword) {
      const schema = it.schema[keyword];
      return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
    }
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/thenElse.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def2 = {
      keyword: ["then", "else"],
      schemaType: ["object", "boolean"],
      code({ keyword, parentSchema, it }) {
        if (parentSchema.if === void 0)
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var additionalItems_1 = require_additionalItems();
    var prefixItems_1 = require_prefixItems();
    var items_1 = require_items();
    var items2020_1 = require_items2020();
    var contains_1 = require_contains();
    var dependencies_1 = require_dependencies();
    var propertyNames_1 = require_propertyNames();
    var additionalProperties_1 = require_additionalProperties();
    var properties_1 = require_properties();
    var patternProperties_1 = require_patternProperties();
    var not_1 = require_not();
    var anyOf_1 = require_anyOf();
    var oneOf_1 = require_oneOf();
    var allOf_1 = require_allOf();
    var if_1 = require_if();
    var thenElse_1 = require_thenElse();
    function getApplicator(draft2020 = false) {
      const applicator = [
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
        propertyNames_1.default,
        additionalProperties_1.default,
        dependencies_1.default,
        properties_1.default,
        patternProperties_1.default
      ];
      if (draft2020)
        applicator.push(prefixItems_1.default, items2020_1.default);
      else
        applicator.push(additionalItems_1.default, items_1.default);
      applicator.push(contains_1.default);
      return applicator;
    }
    exports.default = getApplicator;
  }
});

// node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/format.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
    };
    var def2 = {
      keyword: "format",
      type: ["number", "string"],
      schemaType: "string",
      $data: true,
      error,
      code(cxt, ruleType) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const { opts, errSchemaPath, schemaEnv, self: self2 } = it;
        if (!opts.validateFormats)
          return;
        if ($data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self2.formats,
            code: opts.code.formats
          });
          const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
          const fType = gen.let("fType");
          const format = gen.let("format");
          gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
          cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
          function unknownFmt() {
            if (opts.strictSchema === false)
              return codegen_1.nil;
            return (0, codegen_1._)`${schemaCode} && !${format}`;
          }
          function invalidFmt() {
            const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
            const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
            return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
          }
        }
        function validateFormat() {
          const formatDef = self2.formats[schema];
          if (!formatDef) {
            unknownFormat();
            return;
          }
          if (formatDef === true)
            return;
          const [fmtType, format, fmtRef] = getFormat(formatDef);
          if (fmtType === ruleType)
            cxt.pass(validCondition());
          function unknownFormat() {
            if (opts.strictSchema === false) {
              self2.logger.warn(unknownMsg());
              return;
            }
            throw new Error(unknownMsg());
            function unknownMsg() {
              return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
            }
          }
          function getFormat(fmtDef) {
            const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
            const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
            if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
              return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
            }
            return ["string", fmtDef, fmt];
          }
          function validCondition() {
            if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
              if (!schemaEnv.$async)
                throw new Error("async format in sync schema");
              return (0, codegen_1._)`await ${fmtRef}(${data})`;
            }
            return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
          }
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var format_1 = require_format();
    var format = [format_1.default];
    exports.default = format;
  }
});

// node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS({
  "node_modules/ajv/dist/vocabularies/metadata.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.contentVocabulary = exports.metadataVocabulary = void 0;
    exports.metadataVocabulary = [
      "title",
      "description",
      "default",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples"
    ];
    exports.contentVocabulary = [
      "contentMediaType",
      "contentEncoding",
      "contentSchema"
    ];
  }
});

// node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS({
  "node_modules/ajv/dist/vocabularies/draft7.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var core_1 = require_core2();
    var validation_1 = require_validation();
    var applicator_1 = require_applicator();
    var format_1 = require_format2();
    var metadata_1 = require_metadata();
    var draft7Vocabularies = [
      core_1.default,
      validation_1.default,
      (0, applicator_1.default)(),
      format_1.default,
      metadata_1.metadataVocabulary,
      metadata_1.contentVocabulary
    ];
    exports.default = draft7Vocabularies;
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/types.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiscrError = void 0;
    var DiscrError;
    (function(DiscrError2) {
      DiscrError2["Tag"] = "tag";
      DiscrError2["Mapping"] = "mapping";
    })(DiscrError || (exports.DiscrError = DiscrError = {}));
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var types_1 = require_types();
    var compile_1 = require_compile();
    var ref_error_1 = require_ref_error();
    var util_1 = require_util();
    var error = {
      message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
      params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
    };
    var def2 = {
      keyword: "discriminator",
      type: "object",
      schemaType: "object",
      error,
      code(cxt) {
        const { gen, data, schema, parentSchema, it } = cxt;
        const { oneOf } = parentSchema;
        if (!it.opts.discriminator) {
          throw new Error("discriminator: requires discriminator option");
        }
        const tagName = schema.propertyName;
        if (typeof tagName != "string")
          throw new Error("discriminator: requires propertyName");
        if (schema.mapping)
          throw new Error("discriminator: mapping is not supported");
        if (!oneOf)
          throw new Error("discriminator: requires oneOf keyword");
        const valid = gen.let("valid", false);
        const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
        gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
        cxt.ok(valid);
        function validateMapping() {
          const mapping = getMapping();
          gen.if(false);
          for (const tagValue in mapping) {
            gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
            gen.assign(valid, applyTagSchema(mapping[tagValue]));
          }
          gen.else();
          cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
          gen.endIf();
        }
        function applyTagSchema(schemaProp) {
          const _valid = gen.name("valid");
          const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
          cxt.mergeEvaluated(schCxt, codegen_1.Name);
          return _valid;
        }
        function getMapping() {
          var _a;
          const oneOfMapping = {};
          const topRequired = hasRequired(parentSchema);
          let tagRequired = true;
          for (let i = 0; i < oneOf.length; i++) {
            let sch = oneOf[i];
            if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
              const ref = sch.$ref;
              sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
              if (sch instanceof compile_1.SchemaEnv)
                sch = sch.schema;
              if (sch === void 0)
                throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
            }
            const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
            if (typeof propSch != "object") {
              throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
            }
            tagRequired = tagRequired && (topRequired || hasRequired(sch));
            addMappings(propSch, i);
          }
          if (!tagRequired)
            throw new Error(`discriminator: "${tagName}" must be required`);
          return oneOfMapping;
          function hasRequired({ required }) {
            return Array.isArray(required) && required.includes(tagName);
          }
          function addMappings(sch, i) {
            if (sch.const) {
              addMapping(sch.const, i);
            } else if (sch.enum) {
              for (const tagValue of sch.enum) {
                addMapping(tagValue, i);
              }
            } else {
              throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
            }
          }
          function addMapping(tagValue, i) {
            if (typeof tagValue != "string" || tagValue in oneOfMapping) {
              throw new Error(`discriminator: "${tagName}" values must be unique strings`);
            }
            oneOfMapping[tagValue] = i;
          }
        }
      }
    };
    exports.default = def2;
  }
});

// node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-draft-07.json"(exports, module) {
    module.exports = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "http://json-schema.org/draft-07/schema#",
      title: "Core schema meta-schema",
      definitions: {
        schemaArray: {
          type: "array",
          minItems: 1,
          items: { $ref: "#" }
        },
        nonNegativeInteger: {
          type: "integer",
          minimum: 0
        },
        nonNegativeIntegerDefault0: {
          allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
        },
        simpleTypes: {
          enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
        },
        stringArray: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          default: []
        }
      },
      type: ["object", "boolean"],
      properties: {
        $id: {
          type: "string",
          format: "uri-reference"
        },
        $schema: {
          type: "string",
          format: "uri"
        },
        $ref: {
          type: "string",
          format: "uri-reference"
        },
        $comment: {
          type: "string"
        },
        title: {
          type: "string"
        },
        description: {
          type: "string"
        },
        default: true,
        readOnly: {
          type: "boolean",
          default: false
        },
        examples: {
          type: "array",
          items: true
        },
        multipleOf: {
          type: "number",
          exclusiveMinimum: 0
        },
        maximum: {
          type: "number"
        },
        exclusiveMaximum: {
          type: "number"
        },
        minimum: {
          type: "number"
        },
        exclusiveMinimum: {
          type: "number"
        },
        maxLength: { $ref: "#/definitions/nonNegativeInteger" },
        minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        pattern: {
          type: "string",
          format: "regex"
        },
        additionalItems: { $ref: "#" },
        items: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
          default: true
        },
        maxItems: { $ref: "#/definitions/nonNegativeInteger" },
        minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        uniqueItems: {
          type: "boolean",
          default: false
        },
        contains: { $ref: "#" },
        maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
        minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        required: { $ref: "#/definitions/stringArray" },
        additionalProperties: { $ref: "#" },
        definitions: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        patternProperties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          propertyNames: { format: "regex" },
          default: {}
        },
        dependencies: {
          type: "object",
          additionalProperties: {
            anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
          }
        },
        propertyNames: { $ref: "#" },
        const: true,
        enum: {
          type: "array",
          items: true,
          minItems: 1,
          uniqueItems: true
        },
        type: {
          anyOf: [
            { $ref: "#/definitions/simpleTypes" },
            {
              type: "array",
              items: { $ref: "#/definitions/simpleTypes" },
              minItems: 1,
              uniqueItems: true
            }
          ]
        },
        format: { type: "string" },
        contentMediaType: { type: "string" },
        contentEncoding: { type: "string" },
        if: { $ref: "#" },
        then: { $ref: "#" },
        else: { $ref: "#" },
        allOf: { $ref: "#/definitions/schemaArray" },
        anyOf: { $ref: "#/definitions/schemaArray" },
        oneOf: { $ref: "#/definitions/schemaArray" },
        not: { $ref: "#" }
      },
      default: true
    };
  }
});

// node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS({
  "node_modules/ajv/dist/ajv.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
    var core_1 = require_core();
    var draft7_1 = require_draft7();
    var discriminator_1 = require_discriminator();
    var draft7MetaSchema = require_json_schema_draft_07();
    var META_SUPPORT_DATA = ["/properties"];
    var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
    var Ajv2 = class extends core_1.default {
      _addVocabularies() {
        super._addVocabularies();
        draft7_1.default.forEach((v) => this.addVocabulary(v));
        if (this.opts.discriminator)
          this.addKeyword(discriminator_1.default);
      }
      _addDefaultMetaSchema() {
        super._addDefaultMetaSchema();
        if (!this.opts.meta)
          return;
        const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports.Ajv = Ajv2;
    module.exports = exports = Ajv2;
    module.exports.Ajv = Ajv2;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = Ajv2;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// src/name-rule.ts
function isValidWorkflowName(name) {
  return NAME_RE.test(name);
}
var NAME_RE, WORKFLOW_NAME_PATTERN;
var init_name_rule = __esm({
  "src/name-rule.ts"() {
    "use strict";
    NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
    WORKFLOW_NAME_PATTERN = "^[\\p{L}\\p{N}][\\p{L}\\p{N}_-]{0,63}$";
  }
});

// src/types.ts
var WORKFLOW_SCHEMA;
var init_types = __esm({
  "src/types.ts"() {
    "use strict";
    init_name_rule();
    WORKFLOW_SCHEMA = {
      $id: "https://dag-flow/schemas/workflow.json",
      type: "object",
      required: ["name", "version", "nodes"],
      additionalProperties: false,
      properties: {
        // ★ 名字规则唯一源 name-rule.ts（2026-10-02 修复：此前漏同步，中文名工作流保存得了却过不了执行校验）
        name: { type: "string", pattern: WORKFLOW_NAME_PATTERN },
        version: { const: 1 },
        description: { type: "string" },
        inputs: { type: "object", additionalProperties: true },
        nodes: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["id", "type"],
            additionalProperties: true,
            properties: {
              id: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" },
              type: { type: "string", minLength: 1 },
              params: { type: "object", additionalProperties: true },
              // 分支键映射（单一 object 分支，2026-10-02 修）：
              // if 节点 {true,false} 与 switch 节点 { [case值]: 目标 } 共用同一形状，
              // 必须合成一个分支——若并列两个 object 分支，{true,false} 会同时命中两个，
              // oneOf 要求「恰好命中一个」，会导致所有 if 节点校验失败。
              next: {
                oneOf: [
                  { type: "string" },
                  { type: "array", items: { type: "string" } },
                  {
                    type: "object",
                    minProperties: 1,
                    additionalProperties: { type: "string" }
                  },
                  { type: "null" }
                ]
              },
              onError: {
                oneOf: [
                  { enum: ["stop", "continue"] },
                  {
                    type: "object",
                    required: ["goto"],
                    additionalProperties: false,
                    properties: { goto: { type: "string" } }
                  }
                ]
              },
              label: { type: "string" },
              // ★ 容错开关（2026-10-03）：失败不中断后续层（节点级 onError 在 DAG 模式不生效）
              tolerate: { type: "boolean" }
            }
          }
        },
        // ★ layout=画布节点位置（UI 保存必带；2026-10-02 修复：schema 此前不认 layout，
        //   导致 UI 保存的工作流一执行就被「多余字段」拒绝——「运行按钮没用」的真根因之一）
        layout: { type: "object", additionalProperties: true },
        edges: {
          type: "array",
          items: {
            type: "object",
            required: ["from", "to"],
            additionalProperties: false,
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              // 分支键：if 用 true/false，switch 用 case 值（'*' 兜底），普通边省略
              when: { type: "string" }
            }
          }
        }
      }
    };
  }
});

// src/executor/parse.ts
function zhAjvMessage(m) {
  for (const [re, tpl] of AJV_ZH) {
    const mm = m.match(re);
    if (mm) return tpl.replace(/\$(\d)/g, (_, i) => mm[Number(i)] ?? `$${i}`);
  }
  return m;
}
function nodeTag(node, fallback = "") {
  const id = typeof node?.id === "string" && node.id ? node.id : fallback;
  const label = typeof node?.label === "string" ? node.label : "";
  return label && label !== id ? `${label}_${id}` : id;
}
function locate(def2, instancePath) {
  const raw = instancePath || "/";
  const m = /^\/nodes\/(\d+)((?:\/.*)?)$/.exec(raw);
  if (!m) return raw;
  const idx = Number(m[1]);
  const nodes = def2?.nodes;
  const node = Array.isArray(nodes) ? nodes[idx] : void 0;
  const tag = nodeTag(node, `#${idx}`);
  const type = typeof node?.type === "string" && node.type ? `(${node.type})` : "";
  const rest = (m[2] ?? "").replace(/^\//, "").replace(/\//g, ".");
  return `\u8282\u70B9 ${tag}${type}${rest ? ` \u7684 ${rest}` : ""}`;
}
function parseAndValidate(def2) {
  if (!validateSchema(def2)) {
    const errs = validateSchema.errors ?? [];
    const folded = new Set(
      errs.filter((e) => e.keyword === "oneOf" || e.keyword === "anyOf").map((e) => e.instancePath ?? "")
    );
    const lines = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (line) => {
      if (seen.has(line)) return;
      seen.add(line);
      lines.push(line);
    };
    for (const e of errs) {
      const path8 = e.instancePath ?? "";
      if (folded.has(path8)) {
        const forms = ONEOF_FORMS[path8.split("/").filter(Boolean).pop() ?? ""];
        push(`${locate(def2, path8)} \u7ED3\u6784\u4E0D\u7B26\u5408\u4EFB\u4E00\u5141\u8BB8\u7684\u5F62\u5F0F${forms ? `\uFF08\u5141\u8BB8\uFF1A${forms}\uFF09` : ""}`);
        continue;
      }
      if (e.schemaPath?.includes("/oneOf/") || e.schemaPath?.includes("/anyOf/")) continue;
      push(`${locate(def2, path8)} ${zhAjvMessage(e.message ?? "")}`);
    }
    throw new WorkflowParseError(`\u5DE5\u4F5C\u6D41\u7ED3\u6784\u6821\u9A8C\u672A\u901A\u8FC7: ${lines.join("\uFF1B")}`);
  }
  const wf = def2;
  const ids = /* @__PURE__ */ new Set();
  for (const n of wf.nodes) {
    if (ids.has(n.id)) throw new WorkflowParseError(`\u8282\u70B9 id \u91CD\u590D: ${n.id}`);
    ids.add(n.id);
  }
  for (const n of wf.nodes) {
    if (n.next === void 0 || n.next === null) continue;
    if (typeof n.next === "string") {
      checkRef(n.id, n.next, ids);
    } else if (Array.isArray(n.next)) {
      for (const ref of n.next) checkRef(n.id, ref, ids);
    } else {
      for (const ref of Object.values(n.next)) checkRef(n.id, ref, ids);
    }
    if (n.onError && typeof n.onError === "object" && n.onError.goto) {
      checkRef(n.id, n.onError.goto, ids);
    }
  }
  const starts = wf.nodes.filter((n) => n.type === "start");
  const ends = wf.nodes.filter((n) => n.type === "end");
  if (starts.length !== 1) throw new WorkflowParseError(`start \u8282\u70B9\u5FC5\u987B\u6070\u597D 1 \u4E2A\uFF08\u5F53\u524D ${starts.length} \u4E2A\uFF09`);
  if (ends.length < 1) throw new WorkflowParseError(`\u7F3A\u5C11 end \u8282\u70B9\uFF08\u81F3\u5C11\u9700\u8981 1 \u4E2A\uFF09`);
  const reachable = /* @__PURE__ */ new Set([starts[0].id]);
  const stack = [starts[0].id];
  const edgeTargets = /* @__PURE__ */ new Map();
  for (const e of wf.edges ?? []) {
    const list = edgeTargets.get(e.from) ?? [];
    list.push(e.to);
    edgeTargets.set(e.from, list);
  }
  while (stack.length) {
    const cur = stack.pop();
    const node = wf.nodes.find((n) => n.id === cur);
    if (!node) continue;
    const refs = [...nextRefs(node), ...edgeTargets.get(cur) ?? []];
    for (const r of refs) if (r && !reachable.has(r)) {
      reachable.add(r);
      stack.push(r);
    }
  }
  const orphans = wf.nodes.filter((n) => !reachable.has(n.id) && n.type !== "start");
  if (orphans.length) {
    console.warn(`[dag-flow] \u4EE5\u4E0B\u8282\u70B9\u4E0D\u53EF\u8FBE\uFF08\u672A\u8FDE\u63A5\u5230 start\uFF09: ${orphans.map((o) => o.id).join(", ")}`);
  }
  return wf;
}
function checkRef(from, ref, ids) {
  if (ref === "__end__") return;
  if (!ids.has(ref)) throw new WorkflowParseError(`\u8282\u70B9 "${from}" \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684 id "${ref}"`);
}
function nextRefs(n) {
  if (n.next === void 0 || n.next === null) return [];
  if (typeof n.next === "string") return [n.next];
  if (Array.isArray(n.next)) return n.next;
  return Object.values(n.next);
}
var import_ajv, ajv, validateSchema, WorkflowParseError, AJV_ZH, ONEOF_FORMS;
var init_parse = __esm({
  "src/executor/parse.ts"() {
    "use strict";
    import_ajv = __toESM(require_ajv(), 1);
    init_types();
    ajv = new import_ajv.default({ allErrors: true, strict: false, unicodeRegExp: true });
    validateSchema = ajv.compile(WORKFLOW_SCHEMA);
    WorkflowParseError = class extends Error {
      constructor(msg) {
        super(msg);
        this.name = "WorkflowParseError";
      }
    };
    AJV_ZH = [
      [/must have required property '([^']+)'/, '\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5 "$1"'],
      [/must NOT have additional properties/, "\u5B58\u5728\u4E0D\u5141\u8BB8\u7684\u591A\u4F59\u5B57\u6BB5"],
      [/must be (string|object|array|number|integer|boolean|null)/, "\u7C7B\u578B\u5FC5\u987B\u662F $1"],
      [/must match pattern '([^']+)'/, "\u5FC5\u987B\u5339\u914D\u683C\u5F0F $1"],
      [/must be equal to constant/, "\u503C\u4E0D\u5339\u914D\u8981\u6C42"],
      [/must NOT be shorter than (\d+)/, "\u957F\u5EA6\u4E0D\u80FD\u5C11\u4E8E $1"],
      [/must NOT be longer than (\d+)/, "\u957F\u5EA6\u4E0D\u80FD\u8D85\u8FC7 $1"],
      [/must be >= (-?\d+)/, "\u4E0D\u80FD\u5C0F\u4E8E $1"],
      [/must be <= (-?\d+)/, "\u4E0D\u80FD\u5927\u4E8E $1"],
      [/must NOT have fewer than (\d+) items/, "\u6570\u7EC4\u81F3\u5C11\u9700\u8981 $1 \u9879"],
      [/must NOT have more than (\d+) items/, "\u6570\u7EC4\u4E0D\u80FD\u8D85\u8FC7 $1 \u9879"],
      [/must have unique item/, "\u6570\u7EC4\u5143\u7D20\u5FC5\u987B\u552F\u4E00"],
      [/must NOT be valid/, "\u683C\u5F0F\u4E0D\u5408\u6CD5"]
    ];
    ONEOF_FORMS = {
      next: "\u5B57\u7B26\u4E32 / \u5B57\u7B26\u4E32\u6570\u7EC4 / { \u5206\u652F\u952E: \u76EE\u6807\u8282\u70B9id } \u5BF9\u8C61 / null",
      onError: '"stop" / "continue" / { goto: \u76EE\u6807\u8282\u70B9id }'
    };
  }
});

// src/registry/external.ts
function ctxToScope(ctx) {
  const scope = { ...ctx.inputs, ...ctx.vars, inputs: ctx.inputs, vars: ctx.vars };
  const results = {};
  for (const [id, r] of Object.entries(ctx.results)) {
    const out = r.out ?? null;
    scope[id] = out;
    results[id] = out;
  }
  scope.results = results;
  return scope;
}
function makeResult(status, partial = {}) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    status,
    durationMs: 0,
    startedAt: now,
    endedAt: now,
    ...partial
  };
}
async function safeNodeRun(fn) {
  try {
    return await fn();
  } catch (e) {
    return {
      status: "failed",
      error: {
        code: "UNCAUGHT",
        message: e.message,
        stack: e.stack
      },
      durationMs: 0,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      endedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}
var WorkflowNodeRegistryImpl, WorkflowNodeRegistry;
var init_external = __esm({
  "src/registry/external.ts"() {
    "use strict";
    WorkflowNodeRegistryImpl = class {
      defs = /* @__PURE__ */ new Map();
      register(def2) {
        if (!def2 || typeof def2.type !== "string" || !def2.type) {
          throw new Error("\u6CE8\u518C\u8282\u70B9\u5931\u8D25\uFF1A\u7F3A\u5C11 def.type");
        }
        if (typeof def2.run !== "function") {
          throw new Error(`\u6CE8\u518C\u8282\u70B9 ${def2.type} \u5931\u8D25\uFF1Adef.run \u5FC5\u987B\u662F\u51FD\u6570`);
        }
        if (this.defs.has(def2.type)) {
          console.warn(`[dag-flow] \u8282\u70B9\u7C7B\u578B "${def2.type}" \u88AB\u91CD\u590D\u6CE8\u518C\uFF0C\u5DF2\u8986\u76D6\u4E3A\u540E\u6CE8\u518C\u8005`);
        }
        this.defs.set(def2.type, def2);
      }
      unregister(type) {
        return this.defs.delete(type);
      }
      get(type) {
        return this.defs.get(type);
      }
      list() {
        return Array.from(this.defs.values());
      }
      has(type) {
        return this.defs.has(type);
      }
    };
    WorkflowNodeRegistry = new WorkflowNodeRegistryImpl();
  }
});

// src/registry/params-check.ts
function isBlank(v) {
  return typeof v !== "string" || v.trim().length === 0;
}
function checkNodeParams(type, params, nodeId) {
  const checker = CHECKERS[type];
  if (!checker) return [];
  const msgs = checker(params ?? {});
  return msgs.map((msg) => ({ nodeId, type, msg }));
}
function checkWorkflowParams(def2) {
  const problems = [];
  for (const node of def2.nodes ?? []) {
    problems.push(...checkNodeParams(node.type, node.params, node.id));
  }
  return problems;
}
function formatParamProblems(problems, labels) {
  return problems.map((p) => {
    const tag = labels ? labels(p.nodeId) : p.nodeId;
    return `\u8282\u70B9 ${tag}(${p.type}): ${p.msg}`;
  }).join("\uFF1B");
}
var CHECKERS;
var init_params_check = __esm({
  "src/registry/params-check.ts"() {
    "use strict";
    CHECKERS = {
      python: (p) => isBlank(p.code) && isBlank(p.codePath) ? ["code/codePath \u4E3A\u7A7A\uFF08\u7EAF\u7A7A\u767D\u4E5F\u4E0D\u5141\u8BB8\uFF09\u2014\u2014\u586B\u5199\u8981\u6267\u884C\u7684 Python \u4EE3\u7801"] : [],
      bash: (p) => isBlank(p.code) && isBlank(p.codePath) ? ["code/codePath \u4E3A\u7A7A\uFF08\u7EAF\u7A7A\u767D\u4E5F\u4E0D\u5141\u8BB8\uFF09\u2014\u2014\u586B\u5199\u8981\u6267\u884C\u7684 Bash \u811A\u672C"] : [],
      http: (p) => isBlank(p.url) ? ["url \u4E3A\u7A7A\u2014\u2014\u586B\u5199\u8BF7\u6C42\u5730\u5740\uFF08\u53EF\u5F15\u7528 {{u.out.xxx}}\uFF09"] : [],
      if: (p) => isBlank(p.condition) ? ["condition \u4E3A\u7A7A\u2014\u2014\u6761\u4EF6\u8868\u8FBE\u5F0F\u7F3A\u5931\u4F1A\u9759\u9ED8\u8D70 false \u5206\u652F"] : [],
      switch: (p) => {
        const problems = [];
        if (isBlank(p.value)) problems.push("value \u4E3A\u7A7A\u2014\u2014\u5339\u914D\u503C\u7F3A\u5931\u4F1A\u9759\u9ED8\u5339\u914D\u4E0D\u5230\u4EFB\u4F55\u5206\u652F");
        const cases = p.cases;
        if (cases == null || typeof cases !== "object" || Array.isArray(cases) || Object.keys(cases).length === 0) {
          problems.push('cases \u4E3A\u7A7A\u2014\u2014\u81F3\u5C11\u914D\u7F6E\u4E00\u4E2A\u5206\u652F\uFF08{\u5339\u914D\u503C: \u76EE\u6807\u8282\u70B9id}\uFF09\uFF0C\u6216\u542B "*" \u515C\u5E95');
        }
        return problems;
      },
      log: (p) => isBlank(p.message) ? ['message \u4E3A\u7A7A\u2014\u2014\u65E5\u5FD7\u4F1A\u8F93\u51FA "undefined"'] : [],
      manual: (p) => isBlank(p.prompt) ? ["prompt \u4E3A\u7A7A\u2014\u2014\u7528\u6237\u5C06\u770B\u4E0D\u5230\u4EFB\u4F55\u7B49\u5F85\u8F93\u5165\u7684\u8BF4\u660E"] : [],
      set_var: (p) => {
        const vars = p.vars;
        if (vars == null || typeof vars !== "object" || Array.isArray(vars) || Object.keys(vars).length === 0) {
          return ["vars \u4E3A\u7A7A\u2014\u2014set_var \u8282\u70B9\u6CA1\u6709\u8981\u5199\u5165\u7684\u53D8\u91CF\uFF0C\u5C5E\u4E8E\u65E0\u6548\u8282\u70B9"];
        }
        return [];
      },
      subflow: (p) => isBlank(p.workflowName) ? ["workflowName \u4E3A\u7A7A\u2014\u2014\u586B\u5199\u8981\u8C03\u7528\u7684\u5B50\u5DE5\u4F5C\u6D41\u540D\u79F0"] : [],
      file_save: (p) => isBlank(p.filename) ? ["filename \u4E3A\u7A7A\u2014\u2014\u586B\u5199\u4FDD\u5B58\u6587\u4EF6\u540D\uFF08\u53EF\u542B\u5B50\u76EE\u5F55\uFF09"] : []
    };
  }
});

// src/dsh-gate/host.ts
function getHost() {
  return _host;
}
function hostService(name, host = _host) {
  if (host == null) return void 0;
  const ctx = host;
  try {
    const get = ctx.get;
    if (typeof get === "function") {
      const strict = get.call(host, name);
      if (strict !== void 0 && strict !== null) return strict;
      const lax = get.call(host, name, false);
      if (lax !== void 0 && lax !== null) return lax;
    }
  } catch {
  }
  try {
    return ctx[name];
  } catch {
    return void 0;
  }
}
var _host;
var init_host = __esm({
  "src/dsh-gate/host.ts"() {
    "use strict";
    _host = null;
  }
});

// src/adapter/safety.ts
var init_safety = __esm({
  "src/adapter/safety.ts"() {
    "use strict";
    init_host();
    init_host();
  }
});

// src/dsh-gate/paths.ts
import * as os from "node:os";
import * as path from "node:path";
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}
function sessionsRoot() {
  return path.join(dshHome(), "sessions");
}
function settingsYamlPath() {
  return path.join(dshHome(), "settings.yaml");
}
function credentialsYamlPath() {
  return path.join(dshHome(), ".credentials.yaml");
}
function profilesDir() {
  return path.join(dshHome(), "profiles");
}
function profilePatchPath(profile) {
  return path.join(dshHome(), "profiles", profile, "cordis.patch.yml");
}
var init_paths = __esm({
  "src/dsh-gate/paths.ts"() {
    "use strict";
  }
});

// src/adapter/dsh-home.ts
var init_dsh_home = __esm({
  "src/adapter/dsh-home.ts"() {
    "use strict";
    init_paths();
  }
});

// src/adapter/storage.ts
var storage_exports = {};
__export(storage_exports, {
  createStorage: () => createStorage,
  resolveStorageRoot: () => resolveStorageRoot
});
import { promises as fs } from "node:fs";
import * as path2 from "node:path";
import * as os2 from "node:os";
function probeHostWorkspace() {
  try {
    const host = getHost();
    if (!host) return null;
    const ws = hostService("workspace") ?? hostService("workspaceService");
    const candidates = [
      ws?.cwd,
      ws?.root,
      ws?.path,
      ws?.dir,
      hostService("cwd"),
      hostService("baseDir"),
      hostService("workspacePath")
    ];
    for (const c of candidates) {
      const v = typeof c === "function" ? c() : c;
      if (typeof v === "string" && v && path2.isAbsolute(v)) return v;
    }
  } catch {
  }
  return null;
}
function usableProcessCwd() {
  try {
    const cwd = process.cwd();
    if (!cwd || !path2.isAbsolute(cwd)) return null;
    const lower = cwd.toLowerCase();
    if (lower.endsWith("\\system32") || lower.endsWith("/system32")) return null;
    if (path2.resolve(cwd) === path2.resolve(os2.homedir())) return null;
    return cwd;
  } catch {
    return null;
  }
}
async function probeWorkspaceRegistry() {
  try {
    const wr = hostService("workspaceRegistry");
    if (!wr || typeof wr.list !== "function") return null;
    const list = await wr.list();
    if (!Array.isArray(list) || list.length === 0) return null;
    const paths = list.map((w) => typeof w?.path === "string" ? w.path : "").filter((p) => p && path2.isAbsolute(p));
    const existing = [];
    for (const p of paths) {
      try {
        if ((await fs.stat(p)).isDirectory()) existing.push(p);
      } catch {
      }
    }
    if (existing.length === 0) return null;
    if (existing.length === 1) return existing[0];
    const sorted = [...list].filter((w) => existing.includes(String(w?.path))).sort((a, b) => String(b?.updatedAt ?? "").localeCompare(String(a?.updatedAt ?? "")));
    const best = sorted[0]?.path;
    return typeof best === "string" && best ? best : existing[0];
  } catch {
    return null;
  }
}
async function resolveRoot() {
  if (_info) return _info;
  const fromHost = probeHostWorkspace();
  const fromRegistry = fromHost ? null : await probeWorkspaceRegistry();
  if (fromHost) {
    _info = { dir: path2.join(fromHost, DIR_NAME), source: "host-ctx" };
  } else if (fromRegistry) {
    _info = { dir: path2.join(fromRegistry, DIR_NAME), source: "workspace-registry" };
  } else {
    const cwd = usableProcessCwd();
    if (cwd) {
      _info = { dir: path2.join(cwd, DIR_NAME), source: "process-cwd" };
    } else {
      _info = { dir: path2.join(USER_DIR, "workflows"), source: "user-dir-fallback" };
    }
  }
  await fs.mkdir(_info.dir, { recursive: true });
  if (!_migrated) {
    _migrated = true;
    await migrateFallbackWorkflows(_info);
    await migrateLegacyDirs(_info);
    await migrateLegacySqlite(_info.dir);
  }
  return _info;
}
async function resolveStorageRoot() {
  return resolveRoot();
}
async function migrateFallbackWorkflows(info) {
  if (info.source === "user-dir-fallback") return;
  const oldDir = path2.join(USER_DIR, "workflows");
  if (path2.resolve(oldDir) === path2.resolve(info.dir)) return;
  try {
    const entries = await fs.readdir(oldDir);
    const jsons = entries.filter((f) => f.endsWith(".json") && !f.startsWith("."));
    if (jsons.length === 0) return;
    for (const f of jsons) {
      const dst = path2.join(info.dir, f);
      try {
        await fs.access(dst);
        continue;
      } catch {
      }
      await fs.copyFile(path2.join(oldDir, f), dst);
    }
    const oldVersions = path2.join(oldDir, "versions");
    try {
      await fs.access(oldVersions);
      const newVersions = path2.join(info.dir, "versions");
      try {
        await fs.access(newVersions);
      } catch {
        await fs.cp(oldVersions, newVersions, { recursive: true, force: false, errorOnExist: false });
      }
    } catch {
    }
    console.info("[dag-flow] fallback workflows migrated:", oldDir, "\u2192", info.dir, `(${jsons.length} files)`);
  } catch {
  }
}
async function migrateLegacyDirs(info) {
  for (const legacy of LEGACY_DIR_NAMES) {
    const oldDir = path2.join(path2.dirname(info.dir), legacy);
    if (path2.resolve(oldDir) === path2.resolve(info.dir)) continue;
    try {
      const entries = await fs.readdir(oldDir);
      if (entries.length === 0) continue;
      await fs.mkdir(info.dir, { recursive: true });
      await fs.mkdir(path2.join(info.dir, "runs"), { recursive: true });
      for (const f of entries) {
        const src = path2.join(oldDir, f);
        const dst = path2.join(info.dir, f);
        try {
          await fs.access(dst);
          continue;
        } catch {
        }
        await fs.rename(src, dst);
      }
      const rest = await fs.readdir(oldDir);
      if (rest.length === 0) await fs.rmdir(oldDir);
      console.info("[dag-flow] legacy storage dir migrated:", oldDir, "\u2192", info.dir);
    } catch {
    }
  }
}
async function migrateLegacySqlite(newDir) {
  const legacyDir = path2.join(USER_DIR, "workflows");
  const dbFile = path2.join(legacyDir, "workflows.db");
  try {
    if (!path2.dirname(dbFile)) return;
    await fs.access(dbFile);
  } catch {
    return;
  }
  try {
    const mod = await import("node:sqlite");
    if (typeof mod.DatabaseSync !== "function") return;
    const db = new mod.DatabaseSync(dbFile);
    try {
      const rows = db.prepare("SELECT name, def FROM workflows").all();
      for (const r of rows) {
        if (!isValidWorkflowName(r.name ?? "")) continue;
        const target = path2.join(newDir, `${r.name}.json`);
        try {
          await fs.access(target);
          continue;
        } catch {
        }
        await fs.writeFile(target, JSON.stringify(JSON.parse(r.def), null, 2), "utf8");
      }
    } catch {
    }
    try {
      const runsDir = path2.join(newDir, "runs");
      await fs.mkdir(runsDir, { recursive: true });
      const rows = db.prepare("SELECT run_id, summary FROM runs").all();
      for (const r of rows) {
        const target = path2.join(runsDir, `${r.run_id}.json`);
        try {
          await fs.access(target);
          continue;
        } catch {
        }
        await fs.writeFile(target, JSON.stringify(JSON.parse(r.summary), null, 2), "utf8");
      }
    } catch {
    }
    await fs.rename(dbFile, `${dbFile}.bak`);
    console.info("[dag-flow] legacy SQLite exported to JSON:", newDir, "(workflows.db \u2192 .bak)");
  } catch (e) {
    console.warn("[dag-flow] legacy SQLite migration skipped:", e.message);
  }
}
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
function safeName(name) {
  if (!isValidWorkflowName(name)) {
    throw new Error(`\u5DE5\u4F5C\u6D41\u540D\u79F0\u4E0D\u5408\u6CD5\uFF08\u9700\u4E2D\u6587/\u5B57\u6BCD/\u6570\u5B57\u5F00\u5934\uFF0C\u4EC5\u4E2D\u6587/\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u8FDE\u5B57\u7B26\uFF0C\u226464 \u5B57\u7B26\uFF09: ${name}`);
  }
  return name;
}
async function listJsonNames(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    try {
      const st = await fs.stat(path2.join(dir, f));
      out.push({ name: f.replace(/\.json$/, ""), m: st.mtimeMs });
    } catch {
    }
  }
  return out.sort((a, b) => b.m - a.m).map((x) => x.name);
}
function createStorage() {
  return {
    async describe() {
      return resolveRoot();
    },
    async workflowsDir() {
      return (await resolveRoot()).dir;
    },
    async runsDir() {
      const dir = path2.join(path2.dirname((await resolveRoot()).dir), "runs");
      await ensureDir(dir);
      return dir;
    },
    async readWorkflow(name) {
      const safe = safeName(name);
      const file = path2.join(await this.workflowsDir(), `${safe}.json`);
      try {
        const buf = await fs.readFile(file, "utf8");
        return JSON.parse(buf);
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async writeWorkflow(name, def2, opts) {
      const safe = safeName(name);
      const dir = await this.workflowsDir();
      await ensureDir(dir);
      const file = path2.join(dir, `${safe}.json`);
      const next = JSON.stringify(def2, null, 2);
      if (opts?.snapshot !== false) {
        try {
          const vdir = path2.join(dir, "versions", safe);
          const files = (await fs.readdir(vdir).catch(() => [])).filter((f) => f.endsWith(".json")).sort().reverse();
          const latest = files[0] ? await fs.readFile(path2.join(vdir, files[0]), "utf8").catch(() => null) : null;
          if (latest !== next) {
            await ensureDir(vdir);
            const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
            await fs.writeFile(path2.join(vdir, `${ts}.json`), next, "utf8");
            const vs = (await fs.readdir(vdir)).filter((f) => f.endsWith(".json")).sort().reverse();
            for (const f of vs.slice(20)) await fs.rm(path2.join(vdir, f), { force: true });
          }
        } catch {
        }
      }
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, next, "utf8");
      await fs.rename(tmp, file);
      const renameFrom = opts?.renameFrom;
      if (renameFrom && renameFrom !== name) {
        try {
          const oldSafe = safeName(renameFrom);
          const root = path2.dirname(dir);
          await fs.rm(path2.join(dir, `${oldSafe}.json`), { force: true });
          const pairs = [
            [path2.join(dir, "versions", oldSafe), path2.join(dir, "versions", safe)],
            [path2.join(root, "scripts", oldSafe), path2.join(root, "scripts", safe)]
          ];
          for (const [from, to] of pairs) {
            if (from !== to && await fs.stat(from).catch(() => null) && !await fs.stat(to).catch(() => null)) {
              await fs.rename(from, to);
            }
          }
        } catch {
        }
      }
    },
    async deleteWorkflow(name) {
      const safe = safeName(name);
      const dir = await this.workflowsDir();
      await fs.rm(path2.join(dir, `${safe}.json`), { force: true });
      await fs.rm(path2.join(dir, "versions", safe), { recursive: true, force: true });
    },
    async listVersions(name) {
      const safe = safeName(name);
      const vdir = path2.join(await this.workflowsDir(), "versions", safe);
      try {
        const files = await fs.readdir(vdir);
        return files.filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => ({ ts: f.replace(/\.json$/, "") })).sort((a, b) => a.ts < b.ts ? 1 : -1);
      } catch {
        return [];
      }
    },
    async readVersion(name, ts) {
      const safe = safeName(name);
      const file = path2.join(await this.workflowsDir(), "versions", safe, `${path2.basename(ts)}.json`);
      try {
        const buf = await fs.readFile(file, "utf8");
        return JSON.parse(buf);
      } catch {
        return null;
      }
    },
    async listWorkflows() {
      return listJsonNames(await this.workflowsDir());
    },
    async writeRunRecord(runId, summary) {
      const dir = await this.runsDir();
      const file = path2.join(dir, `${path2.basename(runId)}.json`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(summary, null, 2), "utf8");
      await fs.rename(tmp, file);
    },
    async listRunRecords(workflowName) {
      const dir = await this.runsDir();
      const ids = await listJsonNames(dir);
      if (!workflowName) return ids;
      const out = [];
      for (const id of ids) {
        try {
          const buf = await fs.readFile(path2.join(dir, `${id}.json`), "utf8");
          const r = JSON.parse(buf);
          if (r.workflowName === workflowName) out.push(id);
        } catch {
        }
      }
      return out;
    },
    async readRunRecord(runId) {
      try {
        const buf = await fs.readFile(path2.join(await this.runsDir(), `${path2.basename(runId)}.json`), "utf8");
        return JSON.parse(buf);
      } catch {
        return null;
      }
    }
  };
}
var USER_DIR, DIR_NAME, LEGACY_DIR_NAMES, _info, _migrated;
var init_storage = __esm({
  "src/adapter/storage.ts"() {
    "use strict";
    init_safety();
    init_dsh_home();
    init_name_rule();
    USER_DIR = dshHome();
    DIR_NAME = path2.join(".dag-flow", "workflow");
    LEGACY_DIR_NAMES = [];
    _info = null;
    _migrated = false;
  }
});

// src/executor/record.ts
async function writeRunRecord(summary) {
  const runId = summary.runId;
  await storage.writeRunRecord(runId, summary);
  return runId;
}
var storage;
var init_record = __esm({
  "src/executor/record.ts"() {
    "use strict";
    init_storage();
    storage = createStorage();
  }
});

// src/executor/topo.ts
function topoSort(def2) {
  const nodes = def2.nodes;
  const edges = def2.edges ?? [];
  const idSet = new Set(nodes.map((n) => n.id));
  const adj = /* @__PURE__ */ new Map();
  const indeg = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    adj.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    adj.get(e.from).push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const indegWork = new Map(indeg);
  const order = [];
  const layers = [];
  let frontier = [...indegWork.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  while (frontier.length > 0) {
    layers.push(frontier);
    order.push(...frontier);
    const next = [];
    for (const id of frontier) {
      for (const to of adj.get(id) ?? []) {
        indegWork.set(to, (indegWork.get(to) ?? 0) - 1);
        if (indegWork.get(to) === 0) next.push(to);
      }
    }
    frontier = next;
  }
  if (order.length < nodes.length) {
    const remaining = nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    return { ok: false, layers, order, cyclePath: findCyclePath(adj, remaining), unreachable: [] };
  }
  const startId = nodes.find((n) => n.type === "start")?.id;
  const reachable = /* @__PURE__ */ new Set();
  if (startId) {
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      stack.push(...adj.get(id) ?? []);
    }
  }
  const unreachable = nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id);
  return { ok: true, layers, order, cyclePath: null, unreachable };
}
function findCyclePath(adj, remaining) {
  const color = /* @__PURE__ */ new Map();
  const stack = [];
  for (const n of remaining) color.set(n, 0);
  const dfs = (u) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (!remaining.includes(v)) continue;
      const c = color.get(v);
      if (c === 1) {
        const idx = stack.indexOf(v);
        return [...stack.slice(idx), v];
      }
      if (c === 0) {
        const r = dfs(v);
        if (r) return r;
      }
    }
    color.set(u, 2);
    stack.pop();
    return null;
  };
  for (const n of remaining) {
    if (color.get(n) === 0) {
      const r = dfs(n);
      if (r) return r;
    }
  }
  return null;
}
var init_topo = __esm({
  "src/executor/topo.ts"() {
    "use strict";
  }
});

// src/executor/normalize.ts
function edgesOfNode(n) {
  const out = [];
  const nx = n.next;
  if (nx === void 0 || nx === null) return out;
  const star = n.type === "switch" ? "*" : void 0;
  if (typeof nx === "string") {
    out.push(star ? { from: n.id, to: nx, when: star } : { from: n.id, to: nx });
    return out;
  }
  if (Array.isArray(nx)) {
    for (const t of nx) {
      if (!t) continue;
      out.push(star ? { from: n.id, to: t, when: star } : { from: n.id, to: t });
    }
    return out;
  }
  for (const [key, target] of Object.entries(nx)) {
    if (!target) continue;
    out.push({ from: n.id, to: target, when: key });
  }
  return out;
}
function nextToEdges(nodes) {
  const out = [];
  for (const n of nodes) out.push(...edgesOfNode(n));
  return out;
}
function normalizeDef(def2) {
  if (def2.edges && def2.edges.length > 0) return { def: def2, added: 0 };
  const edges = nextToEdges(def2.nodes);
  if (edges.length === 0) return { def: def2, added: 0 };
  return { def: { ...def2, edges }, added: edges.length };
}
var init_normalize = __esm({
  "src/executor/normalize.ts"() {
    "use strict";
  }
});

// src/executor/awaiting.ts
function newRunId() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function waitForManual(info, signal) {
  return new Promise((resolve4, reject) => {
    const runId = info.runId;
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      pendings.delete(runId);
      reject(new Error("\u8FD0\u884C\u5DF2\u7531\u7528\u6237\u53D6\u6D88"));
    };
    const settle = () => {
      if (settled) return false;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      pendings.delete(runId);
      return true;
    };
    const entry = {
      info,
      onAbort,
      resolve: (r) => {
        if (settle()) resolve4(r);
      },
      reject: (e) => {
        if (settle()) reject(e);
      }
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    pendings.set(runId, entry);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
var pendings;
var init_awaiting = __esm({
  "src/executor/awaiting.ts"() {
    "use strict";
    pendings = /* @__PURE__ */ new Map();
  }
});

// src/executor/dataflow.ts
function resolveRefToken(token, ctx, nodeId) {
  const parts = token.split(".").filter((p) => p.length > 0);
  if (parts.length === 0) return { ok: false, error: `\u8282\u70B9 "${nodeId}" \u4E2D\u5B58\u5728\u7A7A\u5F15\u7528` };
  if (parts[0] === "inputs") {
    let cur2 = ctx.inputs;
    for (let i = 1; i < parts.length; i++) {
      const step = stepInto(cur2, parts[i], `inputs.${parts.slice(1).join(".")}`, nodeId);
      if ("error" in step) return { ok: false, error: step.error };
      cur2 = step.value;
    }
    return { ok: true, value: cur2 };
  }
  if (parts[0] === "vars") {
    let cur2 = ctx.vars;
    for (let i = 1; i < parts.length; i++) {
      const step = stepInto(cur2, parts[i], `vars.${parts.slice(1).join(".")}`, nodeId);
      if ("error" in step) return { ok: false, error: step.error };
      cur2 = step.value;
    }
    return { ok: true, value: cur2 };
  }
  const nodeRef = parts[0];
  const nodeResult = ctx.results[nodeRef];
  if (!nodeResult) {
    return { ok: false, error: `\u8282\u70B9 "${nodeId}" \u5F15\u7528\u4E86 "${nodeRef}"\uFF1A\u8BE5\u8282\u70B9\u5C1A\u672A\u6267\u884C\u6216\u4E0D\u5B58\u5728` };
  }
  if (nodeResult.status !== "success") {
    return { ok: false, error: `\u8282\u70B9 "${nodeId}" \u5F15\u7528\u4E86 "${nodeRef}"\uFF1A\u8BE5\u8282\u70B9\u72B6\u6001\u4E3A "${nodeResult.status}"\uFF08\u672A\u6210\u529F\uFF09\uFF0C\u6CA1\u6709\u53EF\u7528\u7684\u8F93\u51FA` };
  }
  let cur = nodeResult.out ?? null;
  const start = parts[1] === "out" ? 2 : 1;
  for (let i = start; i < parts.length; i++) {
    const step = stepInto(cur, parts[i], parts.slice(1).join("."), nodeId, nodeRef);
    if ("error" in step) return { ok: false, error: step.error };
    cur = step.value;
  }
  return { ok: true, value: cur };
}
function stepInto(cur, key, pathLabel, nodeId, nodeRef) {
  if (Array.isArray(cur)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || String(idx) !== key) {
      return { error: `\u8DEF\u5F84 "${pathLabel}" \u7684 "${key}" \u5904\u9700\u8981\u6570\u5B57\u6570\u7EC4\u4E0B\u6807${nodeRef ? `\uFF08\u8282\u70B9 "${nodeRef}"\uFF09` : ""}\uFF08\u8282\u70B9 ${nodeId}\uFF09` };
    }
    if (idx >= cur.length) {
      return { error: `\u8DEF\u5F84 "${pathLabel}" \u7684\u4E0B\u6807 ${idx} \u8D85\u51FA\u6570\u7EC4\u8303\u56F4\uFF08\u957F\u5EA6 ${cur.length}\uFF09${nodeRef ? `\uFF0C\u8282\u70B9 "${nodeRef}"` : ""}\uFF08\u8282\u70B9 ${nodeId}\uFF09` };
    }
    return { value: cur[idx] ?? null };
  }
  if (cur == null || typeof cur !== "object") {
    return { error: `\u8DEF\u5F84 "${pathLabel}" \u4E0D\u53EF\u8FBE\uFF08\u4E0A\u6E38\u8F93\u51FA\u5728\u8BE5\u5904\u4E0D\u662F\u5BF9\u8C61/\u6570\u7EC4\uFF09${nodeRef ? `\uFF0C\u8282\u70B9 "${nodeRef}"` : ""}\uFF08\u8282\u70B9 ${nodeId}\uFF09` };
  }
  return { value: cur[key] ?? null };
}
function resolveParams(params, ctx, nodeId, opts) {
  const strict = opts?.strict !== false;
  return walk(params);
  function walk(v) {
    if (typeof v === "string") {
      const trimmed = v.trim();
      const inner = trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(2, -2) : null;
      if (inner !== null && !inner.includes("{") && !inner.includes("}")) {
        const token = inner.trim();
        const r = resolveRefToken(token, ctx, nodeId);
        if (r.ok) return r.value;
        if (strict) throw new DataflowError(r.error ?? `\u5F15\u7528\u89E3\u6790\u5931\u8D25: ${token}`);
        return v;
      }
      let out = v;
      let m;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(v)) !== null) {
        const token = m[1].trim();
        const r = resolveRefToken(token, ctx, nodeId);
        if (!r.ok) {
          if (strict) throw new DataflowError(r.error ?? `\u5F15\u7528\u89E3\u6790\u5931\u8D25: ${token}`);
          continue;
        }
        const sv = typeof r.value === "string" ? r.value : JSON.stringify(r.value ?? null);
        out = out.replace(m[0], sv);
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const outObj = {};
      for (const [k, val] of Object.entries(v)) outObj[k] = walk(val);
      return outObj;
    }
    return v;
  }
}
function extractRefs(params) {
  const nodeRefs = /* @__PURE__ */ new Set();
  const varsUsed = /* @__PURE__ */ new Set();
  const inputsUsed = /* @__PURE__ */ new Set();
  const scan = (v) => {
    if (typeof v === "string") {
      const trimmed = v.trim();
      const tokens = [];
      if (trimmed.startsWith("{{") && trimmed.endsWith("}}") && !trimmed.includes("}}", 2)) {
        tokens.push(trimmed.slice(2, -2).trim());
      } else {
        let m;
        REF_RE.lastIndex = 0;
        while ((m = REF_RE.exec(v)) !== null) tokens.push(m[1].trim());
      }
      for (const t of tokens) {
        const parts = t.split(".").filter((p) => p.length > 0);
        if (parts[0] === "vars") varsUsed.add(parts.slice(1).join("."));
        else if (parts[0] === "inputs") inputsUsed.add(parts.slice(1).join("."));
        else if (parts[0] === "results") nodeRefs.add(parts[1] ?? "");
        else nodeRefs.add(parts[0]);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach(scan);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(scan);
  };
  scan(params);
  return { nodeRefs: [...nodeRefs], varsUsed: [...varsUsed], inputsUsed: [...inputsUsed] };
}
var DataflowError, REF_RE;
var init_dataflow = __esm({
  "src/executor/dataflow.ts"() {
    "use strict";
    DataflowError = class extends Error {
      constructor(msg) {
        super(msg);
        this.name = "DataflowError";
      }
    };
    REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
  }
});

// src/executor/run.ts
var run_exports = {};
__export(run_exports, {
  createExecutor: () => createExecutor,
  runWorkflow: () => runWorkflow
});
function invalidParamsSummary(def2, problems) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const summary = {
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workflowName: def2.name,
    status: "failed",
    totalNodes: def2.nodes.length,
    successCount: 0,
    failedCount: 1,
    skippedCount: 0,
    totalDurationMs: 0,
    startedAt,
    endedAt: startedAt,
    results: {},
    error: { code: "NODE_PARAMS_INVALID", message: problems }
  };
  return { summary, record: summary };
}
async function runWorkflow(defInput, opts) {
  const def2 = parseAndValidate(defInput);
  const paramProblems = checkWorkflowParams(def2);
  if (paramProblems.length > 0) {
    return invalidParamsSummary(def2, formatParamProblems(paramProblems, (id) => nodeTag(def2.nodes.find((n) => n.id === id), id)));
  }
  const norm = normalizeDef(def2);
  if (norm.added > 0) {
    opts.logger.info("workflow exec: normalized next \u2192 edges (dag)", { name: def2.name, added: norm.added });
  }
  return runDag(norm.def, opts);
}
async function runDag(def2, opts) {
  const runId = opts.runId ?? newRunId();
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const t0 = Date.now();
  const ctx = {
    inputs: { ...def2.inputs ?? {}, ...opts.inputs ?? {} },
    vars: {},
    results: {},
    signal: opts.signal,
    runId,
    interactive: opts.interactive === true,
    onAwaiting: opts.onAwaiting,
    logger: opts.logger
  };
  const nodeById = new Map(def2.nodes.map((n) => [n.id, n]));
  const dagFail = (code, message) => {
    const summary2 = {
      runId,
      workflowName: def2.name,
      status: "failed",
      totalNodes: def2.nodes.length,
      successCount: 0,
      failedCount: 1,
      skippedCount: 0,
      totalDurationMs: Date.now() - t0,
      startedAt,
      endedAt: startedAt,
      results: {},
      error: { code, message }
    };
    return { summary: summary2, record: summary2 };
  };
  const topo = topoSort(def2);
  if (!topo.ok) {
    return dagFail("DAG_CYCLE", `\u5DE5\u4F5C\u6D41\u5B58\u5728\u73AF\u8DEF: ${topo.cyclePath?.join(" \u2192 ") ?? "cycle"}`);
  }
  const outEdges = /* @__PURE__ */ new Map();
  const inEdgesMap = /* @__PURE__ */ new Map();
  for (const e of def2.edges ?? []) {
    const list = outEdges.get(e.from) ?? [];
    list.push({ to: e.to, when: e.when });
    outEdges.set(e.from, list);
    const inList = inEdgesMap.get(e.to) ?? [];
    inList.push(e.from);
    inEdgesMap.set(e.to, inList);
  }
  {
    const orderIdx = new Map(topo.order.map((id, i) => [id, i]));
    for (const node of def2.nodes) {
      const { nodeRefs } = extractRefs(node.params ?? {});
      for (const ref of nodeRefs) {
        if (ref === node.id) {
          return dagFail("DATAFLOW_SELF_REF", `\u8282\u70B9 "${node.id}" \u5F15\u7528\u4E86\u81EA\u5DF1\uFF08{{${ref}.out}}\uFF09`);
        }
        if (!nodeById.has(ref)) {
          return dagFail("DATAFLOW_UNKNOWN", `\u8282\u70B9 "${node.id}" \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8282\u70B9 "${ref}"`);
        }
        const refIdx = orderIdx.get(ref) ?? -1;
        const curIdx = orderIdx.get(node.id) ?? -1;
        if (refIdx > curIdx) {
          return dagFail("DATAFLOW_ORDER", `\u8282\u70B9 "${node.id}" \u5F15\u7528\u4E86\u6392\u5728\u5B83\u4E4B\u540E\u624D\u6267\u884C\u7684 "${ref}"\uFF08\u6570\u636E\u6D41\u5012\u6302\uFF09`);
        }
      }
    }
  }
  let successCount = 0, failedCount = 0, skippedCount = 0;
  let toleratedCount = 0;
  let firstError;
  const MAX_NODES = 1e5;
  let executed = 0;
  const skipped = /* @__PURE__ */ new Set();
  const policyOf = (node) => {
    if (node?.tolerate === true) return "ignore";
    const oe = node?.onError;
    if (oe === "continue") return "skip";
    if (oe && typeof oe === "object" && oe.goto) return "goto";
    return "stop";
  };
  const edgeKey = (from, when, to) => `${from}|${when ?? ""}|${to}`;
  const hardDead = /* @__PURE__ */ new Set();
  const gotoTargets = /* @__PURE__ */ new Set();
  const layerIndexOf = /* @__PURE__ */ new Map();
  topo.layers.forEach((ids, i) => ids.forEach((id) => layerIndexOf.set(id, i)));
  const recomputeSkipped = () => {
    skipped.clear();
    const dead = new Set(hardDead);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of def2.nodes) {
        if (gotoTargets.has(node.id)) continue;
        const ins = inEdgesMap.get(node.id) ?? [];
        if (ins.length === 0) continue;
        const allDead = ins.every((fromId) => {
          const toMe = (outEdges.get(fromId) ?? []).filter((e) => e.to === node.id);
          return toMe.length > 0 && toMe.every((e) => dead.has(edgeKey(fromId, e.when, node.id)));
        });
        if (!allDead) continue;
        const res = ctx.results[node.id];
        if (res && res.status !== "skipped") continue;
        if (!skipped.has(node.id)) {
          skipped.add(node.id);
          changed = true;
        }
        for (const e of outEdges.get(node.id) ?? []) dead.add(edgeKey(node.id, e.when, e.to));
      }
    }
  };
  for (let layerIdx = 0; layerIdx < topo.layers.length; layerIdx++) {
    const layer = topo.layers[layerIdx];
    recomputeSkipped();
    const results = await Promise.all(layer.map(async (id) => {
      if (skipped.has(id)) {
        const sr = { ...makeResult("skipped", { out: null }), durationMs: 0, startedAt, endedAt: startedAt };
        ctx.results[id] = sr;
        return { id, r: sr, skip: true };
      }
      if (opts.signal?.aborted) {
        return { id, r: { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u8FD0\u884C\u5DF2\u7531\u7528\u6237\u53D6\u6D88" } }), durationMs: 0, startedAt, endedAt: startedAt }, skip: false };
      }
      if (executed >= MAX_NODES) {
        return { id, r: { ...makeResult("failed", { error: { code: "BUDGET_EXCEEDED", message: "\u8282\u70B9\u6267\u884C\u6570\u8D85\u51FA\u9884\u7B97\uFF08100000\uFF09\u2014\u2014\u68C0\u67E5\u662F\u5426\u5B58\u5728\u5931\u63A7\u5FAA\u73AF" } }), durationMs: 0, startedAt, endedAt: startedAt }, skip: false };
      }
      executed++;
      const node = nodeById.get(id);
      if (!node) return { id, r: null, skip: false };
      const defReg = WorkflowNodeRegistry.get(node.type);
      if (!defReg) {
        return { id, r: { ...makeResult("failed", { error: { code: "UNKNOWN_NODE_TYPE", message: `\u8282\u70B9\u7C7B\u578B "${node.type}" \u672A\u6CE8\u518C\uFF08\u63D0\u4F9B\u8BE5\u8282\u70B9\u7684\u63D2\u4EF6\u662F\u5426\u5DF2\u5B89\u88C5\uFF1F\uFF09` } }), durationMs: 0, startedAt, endedAt: startedAt }, skip: false };
      }
      opts.onNodeStart?.(id);
      const r = await safeNodeRun(async () => {
        let resolved = node.params ?? {};
        try {
          const { body: rawBody, ...restParams } = node.params ?? {};
          resolved = node.type === "loop" && rawBody !== void 0 ? { ...resolveParams(restParams, ctx, id), body: rawBody } : resolveParams(node.params ?? {}, ctx, id);
        } catch (e) {
          if (e instanceof DataflowError) {
            return makeResult("failed", { error: { code: "DATAFLOW_REF", message: e.message } });
          }
          throw e;
        }
        return defReg.run({ ...ctx, currentNodeId: id, upstreams: { ...ctx.upstreams, [id]: inEdgesMap.get(id) ?? [] } }, resolved);
      });
      ctx.results[id] = r;
      opts.onNodeDone?.(id, r);
      return { id, r, skip: false };
    }));
    for (const { id, r } of results) {
      const node = nodeById.get(id);
      const edges = outEdges.get(id);
      if (!node || !edges) continue;
      if (r.status === "failed") {
        const policy = policyOf(node);
        if (policy !== "ignore") {
          for (const e of edges) hardDead.add(edgeKey(id, e.when, e.to));
        }
        if (policy === "goto") {
          const target = String(node.onError?.goto ?? "");
          const tLayer = layerIndexOf.get(target);
          if (tLayer !== void 0 && tLayer > layerIdx) {
            gotoTargets.add(target);
          } else if (target) {
            const why = tLayer === void 0 ? "\u76EE\u6807\u4E0D\u5B58\u5728" : ctx.results[target] ? "\u76EE\u6807\u5DF2\u6267\u884C\u8FC7" : "\u76EE\u6807\u5DF2\u8FC7\u5C42";
            if (r.error) r.error = { ...r.error, message: `${r.error.message ?? ""}\uFF08onError.goto \u6307\u5411 "${target}"\uFF1A${why}\uFF0C\u672A\u91CD\u590D\u6267\u884C\u2014\u2014\u76EE\u6807\u53EA\u6267\u884C\u4E00\u6B21\uFF09` };
          }
        }
        continue;
      }
      const isIf = node.type === "if";
      const isSwitch = node.type === "switch";
      if (!isIf && !isSwitch) continue;
      if (r.status !== "success") continue;
      const outVal = r.out ?? null;
      const truthy = Boolean(outVal);
      const matched = String(outVal?.matched ?? "");
      const hasExact = edges.some((e) => e.when === matched);
      for (const e of edges) {
        let active = true;
        if (isIf) {
          active = e.when === "true" ? truthy : e.when === "false" ? !truthy : true;
        } else if (isSwitch) {
          if (e.when === matched) active = true;
          else if (e.when === "*") active = !hasExact;
          else active = false;
        }
        if (!active) hardDead.add(edgeKey(id, e.when, e.to));
      }
    }
    for (const { id, r, skip } of results) {
      if (skip) {
        skippedCount++;
        continue;
      }
      if (r.status === "success") successCount++;
      else if (r.status === "failed") {
        const policy = policyOf(nodeById.get(id));
        if (r.error?.code !== "RUN_CANCELLED" && (policy === "ignore" || policy === "skip")) {
          r.tolerated = true;
          toleratedCount++;
        } else {
          failedCount++;
          if (!firstError) firstError = { code: r.error?.code ?? "NODE_FAILED", message: r.error?.message ?? "node failed", nodeId: id };
        }
      } else skippedCount++;
    }
    if (opts.signal?.aborted) break;
  }
  const endedAt = (/* @__PURE__ */ new Date()).toISOString();
  const summary = {
    runId,
    workflowName: def2.name,
    status: failedCount === 0 ? "success" : "failed",
    totalNodes: def2.nodes.length,
    successCount,
    failedCount,
    skippedCount,
    ...toleratedCount ? { toleratedCount } : {},
    totalDurationMs: Date.now() - t0,
    startedAt,
    endedAt,
    results: ctx.results,
    ...firstError ? { error: firstError } : {}
  };
  opts.logger.info("workflow done (dag)", { runId, name: def2.name, status: summary.status, totalMs: summary.totalDurationMs });
  try {
    await writeRunRecord(summary);
  } catch (e) {
    opts.logger.warn("run record write failed", { error: e.message });
  }
  return { summary, record: summary };
}
function createExecutor() {
  return { run: runWorkflow };
}
var init_run = __esm({
  "src/executor/run.ts"() {
    "use strict";
    init_parse();
    init_external();
    init_external();
    init_params_check();
    init_record();
    init_topo();
    init_normalize();
    init_awaiting();
    init_dataflow();
  }
});

// node_modules/expr-eval/dist/bundle.js
var require_bundle = __commonJS({
  "node_modules/expr-eval/dist/bundle.js"(exports, module) {
    (function(global, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = global || self, factory(global.exprEval = {}));
    })(exports, function(exports2) {
      "use strict";
      var INUMBER = "INUMBER";
      var IOP1 = "IOP1";
      var IOP2 = "IOP2";
      var IOP3 = "IOP3";
      var IVAR = "IVAR";
      var IVARNAME = "IVARNAME";
      var IFUNCALL = "IFUNCALL";
      var IFUNDEF = "IFUNDEF";
      var IEXPR = "IEXPR";
      var IEXPREVAL = "IEXPREVAL";
      var IMEMBER = "IMEMBER";
      var IENDSTATEMENT = "IENDSTATEMENT";
      var IARRAY = "IARRAY";
      function Instruction(type, value) {
        this.type = type;
        this.value = value !== void 0 && value !== null ? value : 0;
      }
      Instruction.prototype.toString = function() {
        switch (this.type) {
          case INUMBER:
          case IOP1:
          case IOP2:
          case IOP3:
          case IVAR:
          case IVARNAME:
          case IENDSTATEMENT:
            return this.value;
          case IFUNCALL:
            return "CALL " + this.value;
          case IFUNDEF:
            return "DEF " + this.value;
          case IARRAY:
            return "ARRAY " + this.value;
          case IMEMBER:
            return "." + this.value;
          default:
            return "Invalid Instruction";
        }
      };
      function unaryInstruction(value) {
        return new Instruction(IOP1, value);
      }
      function binaryInstruction(value) {
        return new Instruction(IOP2, value);
      }
      function ternaryInstruction(value) {
        return new Instruction(IOP3, value);
      }
      function simplify(tokens, unaryOps, binaryOps, ternaryOps, values) {
        var nstack = [];
        var newexpression = [];
        var n1, n2, n3;
        var f;
        for (var i = 0; i < tokens.length; i++) {
          var item = tokens[i];
          var type = item.type;
          if (type === INUMBER || type === IVARNAME) {
            if (Array.isArray(item.value)) {
              nstack.push.apply(nstack, simplify(item.value.map(function(x) {
                return new Instruction(INUMBER, x);
              }).concat(new Instruction(IARRAY, item.value.length)), unaryOps, binaryOps, ternaryOps, values));
            } else {
              nstack.push(item);
            }
          } else if (type === IVAR && values.hasOwnProperty(item.value)) {
            item = new Instruction(INUMBER, values[item.value]);
            nstack.push(item);
          } else if (type === IOP2 && nstack.length > 1) {
            n2 = nstack.pop();
            n1 = nstack.pop();
            f = binaryOps[item.value];
            item = new Instruction(INUMBER, f(n1.value, n2.value));
            nstack.push(item);
          } else if (type === IOP3 && nstack.length > 2) {
            n3 = nstack.pop();
            n2 = nstack.pop();
            n1 = nstack.pop();
            if (item.value === "?") {
              nstack.push(n1.value ? n2.value : n3.value);
            } else {
              f = ternaryOps[item.value];
              item = new Instruction(INUMBER, f(n1.value, n2.value, n3.value));
              nstack.push(item);
            }
          } else if (type === IOP1 && nstack.length > 0) {
            n1 = nstack.pop();
            f = unaryOps[item.value];
            item = new Instruction(INUMBER, f(n1.value));
            nstack.push(item);
          } else if (type === IEXPR) {
            while (nstack.length > 0) {
              newexpression.push(nstack.shift());
            }
            newexpression.push(new Instruction(IEXPR, simplify(item.value, unaryOps, binaryOps, ternaryOps, values)));
          } else if (type === IMEMBER && nstack.length > 0) {
            n1 = nstack.pop();
            nstack.push(new Instruction(INUMBER, n1.value[item.value]));
          } else {
            while (nstack.length > 0) {
              newexpression.push(nstack.shift());
            }
            newexpression.push(item);
          }
        }
        while (nstack.length > 0) {
          newexpression.push(nstack.shift());
        }
        return newexpression;
      }
      function substitute(tokens, variable, expr) {
        var newexpression = [];
        for (var i = 0; i < tokens.length; i++) {
          var item = tokens[i];
          var type = item.type;
          if (type === IVAR && item.value === variable) {
            for (var j = 0; j < expr.tokens.length; j++) {
              var expritem = expr.tokens[j];
              var replitem;
              if (expritem.type === IOP1) {
                replitem = unaryInstruction(expritem.value);
              } else if (expritem.type === IOP2) {
                replitem = binaryInstruction(expritem.value);
              } else if (expritem.type === IOP3) {
                replitem = ternaryInstruction(expritem.value);
              } else {
                replitem = new Instruction(expritem.type, expritem.value);
              }
              newexpression.push(replitem);
            }
          } else if (type === IEXPR) {
            newexpression.push(new Instruction(IEXPR, substitute(item.value, variable, expr)));
          } else {
            newexpression.push(item);
          }
        }
        return newexpression;
      }
      function evaluate(tokens, expr, values) {
        var nstack = [];
        var n1, n2, n3;
        var f, args, argCount;
        if (isExpressionEvaluator(tokens)) {
          return resolveExpression(tokens, values);
        }
        var numTokens = tokens.length;
        for (var i = 0; i < numTokens; i++) {
          var item = tokens[i];
          var type = item.type;
          if (type === INUMBER || type === IVARNAME) {
            nstack.push(item.value);
          } else if (type === IOP2) {
            n2 = nstack.pop();
            n1 = nstack.pop();
            if (item.value === "and") {
              nstack.push(n1 ? !!evaluate(n2, expr, values) : false);
            } else if (item.value === "or") {
              nstack.push(n1 ? true : !!evaluate(n2, expr, values));
            } else if (item.value === "=") {
              f = expr.binaryOps[item.value];
              nstack.push(f(n1, evaluate(n2, expr, values), values));
            } else {
              f = expr.binaryOps[item.value];
              nstack.push(f(resolveExpression(n1, values), resolveExpression(n2, values)));
            }
          } else if (type === IOP3) {
            n3 = nstack.pop();
            n2 = nstack.pop();
            n1 = nstack.pop();
            if (item.value === "?") {
              nstack.push(evaluate(n1 ? n2 : n3, expr, values));
            } else {
              f = expr.ternaryOps[item.value];
              nstack.push(f(resolveExpression(n1, values), resolveExpression(n2, values), resolveExpression(n3, values)));
            }
          } else if (type === IVAR) {
            if (item.value in expr.functions) {
              nstack.push(expr.functions[item.value]);
            } else if (item.value in expr.unaryOps && expr.parser.isOperatorEnabled(item.value)) {
              nstack.push(expr.unaryOps[item.value]);
            } else {
              var v = values[item.value];
              if (v !== void 0) {
                nstack.push(v);
              } else {
                throw new Error("undefined variable: " + item.value);
              }
            }
          } else if (type === IOP1) {
            n1 = nstack.pop();
            f = expr.unaryOps[item.value];
            nstack.push(f(resolveExpression(n1, values)));
          } else if (type === IFUNCALL) {
            argCount = item.value;
            args = [];
            while (argCount-- > 0) {
              args.unshift(resolveExpression(nstack.pop(), values));
            }
            f = nstack.pop();
            if (f.apply && f.call) {
              nstack.push(f.apply(void 0, args));
            } else {
              throw new Error(f + " is not a function");
            }
          } else if (type === IFUNDEF) {
            nstack.push((function() {
              var n22 = nstack.pop();
              var args2 = [];
              var argCount2 = item.value;
              while (argCount2-- > 0) {
                args2.unshift(nstack.pop());
              }
              var n12 = nstack.pop();
              var f2 = function() {
                var scope = Object.assign({}, values);
                for (var i2 = 0, len = args2.length; i2 < len; i2++) {
                  scope[args2[i2]] = arguments[i2];
                }
                return evaluate(n22, expr, scope);
              };
              Object.defineProperty(f2, "name", {
                value: n12,
                writable: false
              });
              values[n12] = f2;
              return f2;
            })());
          } else if (type === IEXPR) {
            nstack.push(createExpressionEvaluator(item, expr));
          } else if (type === IEXPREVAL) {
            nstack.push(item);
          } else if (type === IMEMBER) {
            n1 = nstack.pop();
            nstack.push(n1[item.value]);
          } else if (type === IENDSTATEMENT) {
            nstack.pop();
          } else if (type === IARRAY) {
            argCount = item.value;
            args = [];
            while (argCount-- > 0) {
              args.unshift(nstack.pop());
            }
            nstack.push(args);
          } else {
            throw new Error("invalid Expression");
          }
        }
        if (nstack.length > 1) {
          throw new Error("invalid Expression (parity)");
        }
        return nstack[0] === 0 ? 0 : resolveExpression(nstack[0], values);
      }
      function createExpressionEvaluator(token, expr, values) {
        if (isExpressionEvaluator(token)) return token;
        return {
          type: IEXPREVAL,
          value: function(scope) {
            return evaluate(token.value, expr, scope);
          }
        };
      }
      function isExpressionEvaluator(n) {
        return n && n.type === IEXPREVAL;
      }
      function resolveExpression(n, values) {
        return isExpressionEvaluator(n) ? n.value(values) : n;
      }
      function expressionToString(tokens, toJS) {
        var nstack = [];
        var n1, n2, n3;
        var f, args, argCount;
        for (var i = 0; i < tokens.length; i++) {
          var item = tokens[i];
          var type = item.type;
          if (type === INUMBER) {
            if (typeof item.value === "number" && item.value < 0) {
              nstack.push("(" + item.value + ")");
            } else if (Array.isArray(item.value)) {
              nstack.push("[" + item.value.map(escapeValue).join(", ") + "]");
            } else {
              nstack.push(escapeValue(item.value));
            }
          } else if (type === IOP2) {
            n2 = nstack.pop();
            n1 = nstack.pop();
            f = item.value;
            if (toJS) {
              if (f === "^") {
                nstack.push("Math.pow(" + n1 + ", " + n2 + ")");
              } else if (f === "and") {
                nstack.push("(!!" + n1 + " && !!" + n2 + ")");
              } else if (f === "or") {
                nstack.push("(!!" + n1 + " || !!" + n2 + ")");
              } else if (f === "||") {
                nstack.push("(function(a,b){ return Array.isArray(a) && Array.isArray(b) ? a.concat(b) : String(a) + String(b); }((" + n1 + "),(" + n2 + ")))");
              } else if (f === "==") {
                nstack.push("(" + n1 + " === " + n2 + ")");
              } else if (f === "!=") {
                nstack.push("(" + n1 + " !== " + n2 + ")");
              } else if (f === "[") {
                nstack.push(n1 + "[(" + n2 + ") | 0]");
              } else {
                nstack.push("(" + n1 + " " + f + " " + n2 + ")");
              }
            } else {
              if (f === "[") {
                nstack.push(n1 + "[" + n2 + "]");
              } else {
                nstack.push("(" + n1 + " " + f + " " + n2 + ")");
              }
            }
          } else if (type === IOP3) {
            n3 = nstack.pop();
            n2 = nstack.pop();
            n1 = nstack.pop();
            f = item.value;
            if (f === "?") {
              nstack.push("(" + n1 + " ? " + n2 + " : " + n3 + ")");
            } else {
              throw new Error("invalid Expression");
            }
          } else if (type === IVAR || type === IVARNAME) {
            nstack.push(item.value);
          } else if (type === IOP1) {
            n1 = nstack.pop();
            f = item.value;
            if (f === "-" || f === "+") {
              nstack.push("(" + f + n1 + ")");
            } else if (toJS) {
              if (f === "not") {
                nstack.push("(!" + n1 + ")");
              } else if (f === "!") {
                nstack.push("fac(" + n1 + ")");
              } else {
                nstack.push(f + "(" + n1 + ")");
              }
            } else if (f === "!") {
              nstack.push("(" + n1 + "!)");
            } else {
              nstack.push("(" + f + " " + n1 + ")");
            }
          } else if (type === IFUNCALL) {
            argCount = item.value;
            args = [];
            while (argCount-- > 0) {
              args.unshift(nstack.pop());
            }
            f = nstack.pop();
            nstack.push(f + "(" + args.join(", ") + ")");
          } else if (type === IFUNDEF) {
            n2 = nstack.pop();
            argCount = item.value;
            args = [];
            while (argCount-- > 0) {
              args.unshift(nstack.pop());
            }
            n1 = nstack.pop();
            if (toJS) {
              nstack.push("(" + n1 + " = function(" + args.join(", ") + ") { return " + n2 + " })");
            } else {
              nstack.push("(" + n1 + "(" + args.join(", ") + ") = " + n2 + ")");
            }
          } else if (type === IMEMBER) {
            n1 = nstack.pop();
            nstack.push(n1 + "." + item.value);
          } else if (type === IARRAY) {
            argCount = item.value;
            args = [];
            while (argCount-- > 0) {
              args.unshift(nstack.pop());
            }
            nstack.push("[" + args.join(", ") + "]");
          } else if (type === IEXPR) {
            nstack.push("(" + expressionToString(item.value, toJS) + ")");
          } else if (type === IENDSTATEMENT) ;
          else {
            throw new Error("invalid Expression");
          }
        }
        if (nstack.length > 1) {
          if (toJS) {
            nstack = [nstack.join(",")];
          } else {
            nstack = [nstack.join(";")];
          }
        }
        return String(nstack[0]);
      }
      function escapeValue(v) {
        if (typeof v === "string") {
          return JSON.stringify(v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
        }
        return v;
      }
      function contains(array, obj) {
        for (var i = 0; i < array.length; i++) {
          if (array[i] === obj) {
            return true;
          }
        }
        return false;
      }
      function getSymbols(tokens, symbols, options) {
        options = options || {};
        var withMembers = !!options.withMembers;
        var prevVar = null;
        for (var i = 0; i < tokens.length; i++) {
          var item = tokens[i];
          if (item.type === IVAR || item.type === IVARNAME) {
            if (!withMembers && !contains(symbols, item.value)) {
              symbols.push(item.value);
            } else if (prevVar !== null) {
              if (!contains(symbols, prevVar)) {
                symbols.push(prevVar);
              }
              prevVar = item.value;
            } else {
              prevVar = item.value;
            }
          } else if (item.type === IMEMBER && withMembers && prevVar !== null) {
            prevVar += "." + item.value;
          } else if (item.type === IEXPR) {
            getSymbols(item.value, symbols, options);
          } else if (prevVar !== null) {
            if (!contains(symbols, prevVar)) {
              symbols.push(prevVar);
            }
            prevVar = null;
          }
        }
        if (prevVar !== null && !contains(symbols, prevVar)) {
          symbols.push(prevVar);
        }
      }
      function Expression(tokens, parser2) {
        this.tokens = tokens;
        this.parser = parser2;
        this.unaryOps = parser2.unaryOps;
        this.binaryOps = parser2.binaryOps;
        this.ternaryOps = parser2.ternaryOps;
        this.functions = parser2.functions;
      }
      Expression.prototype.simplify = function(values) {
        values = values || {};
        return new Expression(simplify(this.tokens, this.unaryOps, this.binaryOps, this.ternaryOps, values), this.parser);
      };
      Expression.prototype.substitute = function(variable, expr) {
        if (!(expr instanceof Expression)) {
          expr = this.parser.parse(String(expr));
        }
        return new Expression(substitute(this.tokens, variable, expr), this.parser);
      };
      Expression.prototype.evaluate = function(values) {
        values = values || {};
        return evaluate(this.tokens, this, values);
      };
      Expression.prototype.toString = function() {
        return expressionToString(this.tokens, false);
      };
      Expression.prototype.symbols = function(options) {
        options = options || {};
        var vars = [];
        getSymbols(this.tokens, vars, options);
        return vars;
      };
      Expression.prototype.variables = function(options) {
        options = options || {};
        var vars = [];
        getSymbols(this.tokens, vars, options);
        var functions = this.functions;
        return vars.filter(function(name) {
          return !(name in functions);
        });
      };
      Expression.prototype.toJSFunction = function(param, variables) {
        var expr = this;
        var f = new Function(param, "with(this.functions) with (this.ternaryOps) with (this.binaryOps) with (this.unaryOps) { return " + expressionToString(this.simplify(variables).tokens, true) + "; }");
        return function() {
          return f.apply(expr, arguments);
        };
      };
      var TEOF = "TEOF";
      var TOP = "TOP";
      var TNUMBER = "TNUMBER";
      var TSTRING = "TSTRING";
      var TPAREN = "TPAREN";
      var TBRACKET = "TBRACKET";
      var TCOMMA = "TCOMMA";
      var TNAME = "TNAME";
      var TSEMICOLON = "TSEMICOLON";
      function Token(type, value, index2) {
        this.type = type;
        this.value = value;
        this.index = index2;
      }
      Token.prototype.toString = function() {
        return this.type + ": " + this.value;
      };
      function TokenStream(parser2, expression) {
        this.pos = 0;
        this.current = null;
        this.unaryOps = parser2.unaryOps;
        this.binaryOps = parser2.binaryOps;
        this.ternaryOps = parser2.ternaryOps;
        this.consts = parser2.consts;
        this.expression = expression;
        this.savedPosition = 0;
        this.savedCurrent = null;
        this.options = parser2.options;
        this.parser = parser2;
      }
      TokenStream.prototype.newToken = function(type, value, pos) {
        return new Token(type, value, pos != null ? pos : this.pos);
      };
      TokenStream.prototype.save = function() {
        this.savedPosition = this.pos;
        this.savedCurrent = this.current;
      };
      TokenStream.prototype.restore = function() {
        this.pos = this.savedPosition;
        this.current = this.savedCurrent;
      };
      TokenStream.prototype.next = function() {
        if (this.pos >= this.expression.length) {
          return this.newToken(TEOF, "EOF");
        }
        if (this.isWhitespace() || this.isComment()) {
          return this.next();
        } else if (this.isRadixInteger() || this.isNumber() || this.isOperator() || this.isString() || this.isParen() || this.isBracket() || this.isComma() || this.isSemicolon() || this.isNamedOp() || this.isConst() || this.isName()) {
          return this.current;
        } else {
          this.parseError('Unknown character "' + this.expression.charAt(this.pos) + '"');
        }
      };
      TokenStream.prototype.isString = function() {
        var r = false;
        var startPos = this.pos;
        var quote = this.expression.charAt(startPos);
        if (quote === "'" || quote === '"') {
          var index2 = this.expression.indexOf(quote, startPos + 1);
          while (index2 >= 0 && this.pos < this.expression.length) {
            this.pos = index2 + 1;
            if (this.expression.charAt(index2 - 1) !== "\\") {
              var rawString = this.expression.substring(startPos + 1, index2);
              this.current = this.newToken(TSTRING, this.unescape(rawString), startPos);
              r = true;
              break;
            }
            index2 = this.expression.indexOf(quote, index2 + 1);
          }
        }
        return r;
      };
      TokenStream.prototype.isParen = function() {
        var c = this.expression.charAt(this.pos);
        if (c === "(" || c === ")") {
          this.current = this.newToken(TPAREN, c);
          this.pos++;
          return true;
        }
        return false;
      };
      TokenStream.prototype.isBracket = function() {
        var c = this.expression.charAt(this.pos);
        if ((c === "[" || c === "]") && this.isOperatorEnabled("[")) {
          this.current = this.newToken(TBRACKET, c);
          this.pos++;
          return true;
        }
        return false;
      };
      TokenStream.prototype.isComma = function() {
        var c = this.expression.charAt(this.pos);
        if (c === ",") {
          this.current = this.newToken(TCOMMA, ",");
          this.pos++;
          return true;
        }
        return false;
      };
      TokenStream.prototype.isSemicolon = function() {
        var c = this.expression.charAt(this.pos);
        if (c === ";") {
          this.current = this.newToken(TSEMICOLON, ";");
          this.pos++;
          return true;
        }
        return false;
      };
      TokenStream.prototype.isConst = function() {
        var startPos = this.pos;
        var i = startPos;
        for (; i < this.expression.length; i++) {
          var c = this.expression.charAt(i);
          if (c.toUpperCase() === c.toLowerCase()) {
            if (i === this.pos || c !== "_" && c !== "." && (c < "0" || c > "9")) {
              break;
            }
          }
        }
        if (i > startPos) {
          var str = this.expression.substring(startPos, i);
          if (str in this.consts) {
            this.current = this.newToken(TNUMBER, this.consts[str]);
            this.pos += str.length;
            return true;
          }
        }
        return false;
      };
      TokenStream.prototype.isNamedOp = function() {
        var startPos = this.pos;
        var i = startPos;
        for (; i < this.expression.length; i++) {
          var c = this.expression.charAt(i);
          if (c.toUpperCase() === c.toLowerCase()) {
            if (i === this.pos || c !== "_" && (c < "0" || c > "9")) {
              break;
            }
          }
        }
        if (i > startPos) {
          var str = this.expression.substring(startPos, i);
          if (this.isOperatorEnabled(str) && (str in this.binaryOps || str in this.unaryOps || str in this.ternaryOps)) {
            this.current = this.newToken(TOP, str);
            this.pos += str.length;
            return true;
          }
        }
        return false;
      };
      TokenStream.prototype.isName = function() {
        var startPos = this.pos;
        var i = startPos;
        var hasLetter = false;
        for (; i < this.expression.length; i++) {
          var c = this.expression.charAt(i);
          if (c.toUpperCase() === c.toLowerCase()) {
            if (i === this.pos && (c === "$" || c === "_")) {
              if (c === "_") {
                hasLetter = true;
              }
              continue;
            } else if (i === this.pos || !hasLetter || c !== "_" && (c < "0" || c > "9")) {
              break;
            }
          } else {
            hasLetter = true;
          }
        }
        if (hasLetter) {
          var str = this.expression.substring(startPos, i);
          this.current = this.newToken(TNAME, str);
          this.pos += str.length;
          return true;
        }
        return false;
      };
      TokenStream.prototype.isWhitespace = function() {
        var r = false;
        var c = this.expression.charAt(this.pos);
        while (c === " " || c === "	" || c === "\n" || c === "\r") {
          r = true;
          this.pos++;
          if (this.pos >= this.expression.length) {
            break;
          }
          c = this.expression.charAt(this.pos);
        }
        return r;
      };
      var codePointPattern = /^[0-9a-f]{4}$/i;
      TokenStream.prototype.unescape = function(v) {
        var index2 = v.indexOf("\\");
        if (index2 < 0) {
          return v;
        }
        var buffer = v.substring(0, index2);
        while (index2 >= 0) {
          var c = v.charAt(++index2);
          switch (c) {
            case "'":
              buffer += "'";
              break;
            case '"':
              buffer += '"';
              break;
            case "\\":
              buffer += "\\";
              break;
            case "/":
              buffer += "/";
              break;
            case "b":
              buffer += "\b";
              break;
            case "f":
              buffer += "\f";
              break;
            case "n":
              buffer += "\n";
              break;
            case "r":
              buffer += "\r";
              break;
            case "t":
              buffer += "	";
              break;
            case "u":
              var codePoint = v.substring(index2 + 1, index2 + 5);
              if (!codePointPattern.test(codePoint)) {
                this.parseError("Illegal escape sequence: \\u" + codePoint);
              }
              buffer += String.fromCharCode(parseInt(codePoint, 16));
              index2 += 4;
              break;
            default:
              throw this.parseError('Illegal escape sequence: "\\' + c + '"');
          }
          ++index2;
          var backslash = v.indexOf("\\", index2);
          buffer += v.substring(index2, backslash < 0 ? v.length : backslash);
          index2 = backslash;
        }
        return buffer;
      };
      TokenStream.prototype.isComment = function() {
        var c = this.expression.charAt(this.pos);
        if (c === "/" && this.expression.charAt(this.pos + 1) === "*") {
          this.pos = this.expression.indexOf("*/", this.pos) + 2;
          if (this.pos === 1) {
            this.pos = this.expression.length;
          }
          return true;
        }
        return false;
      };
      TokenStream.prototype.isRadixInteger = function() {
        var pos = this.pos;
        if (pos >= this.expression.length - 2 || this.expression.charAt(pos) !== "0") {
          return false;
        }
        ++pos;
        var radix;
        var validDigit;
        if (this.expression.charAt(pos) === "x") {
          radix = 16;
          validDigit = /^[0-9a-f]$/i;
          ++pos;
        } else if (this.expression.charAt(pos) === "b") {
          radix = 2;
          validDigit = /^[01]$/i;
          ++pos;
        } else {
          return false;
        }
        var valid = false;
        var startPos = pos;
        while (pos < this.expression.length) {
          var c = this.expression.charAt(pos);
          if (validDigit.test(c)) {
            pos++;
            valid = true;
          } else {
            break;
          }
        }
        if (valid) {
          this.current = this.newToken(TNUMBER, parseInt(this.expression.substring(startPos, pos), radix));
          this.pos = pos;
        }
        return valid;
      };
      TokenStream.prototype.isNumber = function() {
        var valid = false;
        var pos = this.pos;
        var startPos = pos;
        var resetPos = pos;
        var foundDot = false;
        var foundDigits = false;
        var c;
        while (pos < this.expression.length) {
          c = this.expression.charAt(pos);
          if (c >= "0" && c <= "9" || !foundDot && c === ".") {
            if (c === ".") {
              foundDot = true;
            } else {
              foundDigits = true;
            }
            pos++;
            valid = foundDigits;
          } else {
            break;
          }
        }
        if (valid) {
          resetPos = pos;
        }
        if (c === "e" || c === "E") {
          pos++;
          var acceptSign = true;
          var validExponent = false;
          while (pos < this.expression.length) {
            c = this.expression.charAt(pos);
            if (acceptSign && (c === "+" || c === "-")) {
              acceptSign = false;
            } else if (c >= "0" && c <= "9") {
              validExponent = true;
              acceptSign = false;
            } else {
              break;
            }
            pos++;
          }
          if (!validExponent) {
            pos = resetPos;
          }
        }
        if (valid) {
          this.current = this.newToken(TNUMBER, parseFloat(this.expression.substring(startPos, pos)));
          this.pos = pos;
        } else {
          this.pos = resetPos;
        }
        return valid;
      };
      TokenStream.prototype.isOperator = function() {
        var startPos = this.pos;
        var c = this.expression.charAt(this.pos);
        if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%" || c === "^" || c === "?" || c === ":" || c === ".") {
          this.current = this.newToken(TOP, c);
        } else if (c === "\u2219" || c === "\u2022") {
          this.current = this.newToken(TOP, "*");
        } else if (c === ">") {
          if (this.expression.charAt(this.pos + 1) === "=") {
            this.current = this.newToken(TOP, ">=");
            this.pos++;
          } else {
            this.current = this.newToken(TOP, ">");
          }
        } else if (c === "<") {
          if (this.expression.charAt(this.pos + 1) === "=") {
            this.current = this.newToken(TOP, "<=");
            this.pos++;
          } else {
            this.current = this.newToken(TOP, "<");
          }
        } else if (c === "|") {
          if (this.expression.charAt(this.pos + 1) === "|") {
            this.current = this.newToken(TOP, "||");
            this.pos++;
          } else {
            return false;
          }
        } else if (c === "=") {
          if (this.expression.charAt(this.pos + 1) === "=") {
            this.current = this.newToken(TOP, "==");
            this.pos++;
          } else {
            this.current = this.newToken(TOP, c);
          }
        } else if (c === "!") {
          if (this.expression.charAt(this.pos + 1) === "=") {
            this.current = this.newToken(TOP, "!=");
            this.pos++;
          } else {
            this.current = this.newToken(TOP, c);
          }
        } else {
          return false;
        }
        this.pos++;
        if (this.isOperatorEnabled(this.current.value)) {
          return true;
        } else {
          this.pos = startPos;
          return false;
        }
      };
      TokenStream.prototype.isOperatorEnabled = function(op) {
        return this.parser.isOperatorEnabled(op);
      };
      TokenStream.prototype.getCoordinates = function() {
        var line = 0;
        var column;
        var newline = -1;
        do {
          line++;
          column = this.pos - newline;
          newline = this.expression.indexOf("\n", newline + 1);
        } while (newline >= 0 && newline < this.pos);
        return {
          line,
          column
        };
      };
      TokenStream.prototype.parseError = function(msg) {
        var coords = this.getCoordinates();
        throw new Error("parse error [" + coords.line + ":" + coords.column + "]: " + msg);
      };
      function ParserState(parser2, tokenStream, options) {
        this.parser = parser2;
        this.tokens = tokenStream;
        this.current = null;
        this.nextToken = null;
        this.next();
        this.savedCurrent = null;
        this.savedNextToken = null;
        this.allowMemberAccess = options.allowMemberAccess !== false;
      }
      ParserState.prototype.next = function() {
        this.current = this.nextToken;
        return this.nextToken = this.tokens.next();
      };
      ParserState.prototype.tokenMatches = function(token, value) {
        if (typeof value === "undefined") {
          return true;
        } else if (Array.isArray(value)) {
          return contains(value, token.value);
        } else if (typeof value === "function") {
          return value(token);
        } else {
          return token.value === value;
        }
      };
      ParserState.prototype.save = function() {
        this.savedCurrent = this.current;
        this.savedNextToken = this.nextToken;
        this.tokens.save();
      };
      ParserState.prototype.restore = function() {
        this.tokens.restore();
        this.current = this.savedCurrent;
        this.nextToken = this.savedNextToken;
      };
      ParserState.prototype.accept = function(type, value) {
        if (this.nextToken.type === type && this.tokenMatches(this.nextToken, value)) {
          this.next();
          return true;
        }
        return false;
      };
      ParserState.prototype.expect = function(type, value) {
        if (!this.accept(type, value)) {
          var coords = this.tokens.getCoordinates();
          throw new Error("parse error [" + coords.line + ":" + coords.column + "]: Expected " + (value || type));
        }
      };
      ParserState.prototype.parseAtom = function(instr) {
        var unaryOps = this.tokens.unaryOps;
        function isPrefixOperator(token) {
          return token.value in unaryOps;
        }
        if (this.accept(TNAME) || this.accept(TOP, isPrefixOperator)) {
          instr.push(new Instruction(IVAR, this.current.value));
        } else if (this.accept(TNUMBER)) {
          instr.push(new Instruction(INUMBER, this.current.value));
        } else if (this.accept(TSTRING)) {
          instr.push(new Instruction(INUMBER, this.current.value));
        } else if (this.accept(TPAREN, "(")) {
          this.parseExpression(instr);
          this.expect(TPAREN, ")");
        } else if (this.accept(TBRACKET, "[")) {
          if (this.accept(TBRACKET, "]")) {
            instr.push(new Instruction(IARRAY, 0));
          } else {
            var argCount = this.parseArrayList(instr);
            instr.push(new Instruction(IARRAY, argCount));
          }
        } else {
          throw new Error("unexpected " + this.nextToken);
        }
      };
      ParserState.prototype.parseExpression = function(instr) {
        var exprInstr = [];
        if (this.parseUntilEndStatement(instr, exprInstr)) {
          return;
        }
        this.parseVariableAssignmentExpression(exprInstr);
        if (this.parseUntilEndStatement(instr, exprInstr)) {
          return;
        }
        this.pushExpression(instr, exprInstr);
      };
      ParserState.prototype.pushExpression = function(instr, exprInstr) {
        for (var i = 0, len = exprInstr.length; i < len; i++) {
          instr.push(exprInstr[i]);
        }
      };
      ParserState.prototype.parseUntilEndStatement = function(instr, exprInstr) {
        if (!this.accept(TSEMICOLON)) return false;
        if (this.nextToken && this.nextToken.type !== TEOF && !(this.nextToken.type === TPAREN && this.nextToken.value === ")")) {
          exprInstr.push(new Instruction(IENDSTATEMENT));
        }
        if (this.nextToken.type !== TEOF) {
          this.parseExpression(exprInstr);
        }
        instr.push(new Instruction(IEXPR, exprInstr));
        return true;
      };
      ParserState.prototype.parseArrayList = function(instr) {
        var argCount = 0;
        while (!this.accept(TBRACKET, "]")) {
          this.parseExpression(instr);
          ++argCount;
          while (this.accept(TCOMMA)) {
            this.parseExpression(instr);
            ++argCount;
          }
        }
        return argCount;
      };
      ParserState.prototype.parseVariableAssignmentExpression = function(instr) {
        this.parseConditionalExpression(instr);
        while (this.accept(TOP, "=")) {
          var varName = instr.pop();
          var varValue = [];
          var lastInstrIndex = instr.length - 1;
          if (varName.type === IFUNCALL) {
            if (!this.tokens.isOperatorEnabled("()=")) {
              throw new Error("function definition is not permitted");
            }
            for (var i = 0, len = varName.value + 1; i < len; i++) {
              var index2 = lastInstrIndex - i;
              if (instr[index2].type === IVAR) {
                instr[index2] = new Instruction(IVARNAME, instr[index2].value);
              }
            }
            this.parseVariableAssignmentExpression(varValue);
            instr.push(new Instruction(IEXPR, varValue));
            instr.push(new Instruction(IFUNDEF, varName.value));
            continue;
          }
          if (varName.type !== IVAR && varName.type !== IMEMBER) {
            throw new Error("expected variable for assignment");
          }
          this.parseVariableAssignmentExpression(varValue);
          instr.push(new Instruction(IVARNAME, varName.value));
          instr.push(new Instruction(IEXPR, varValue));
          instr.push(binaryInstruction("="));
        }
      };
      ParserState.prototype.parseConditionalExpression = function(instr) {
        this.parseOrExpression(instr);
        while (this.accept(TOP, "?")) {
          var trueBranch = [];
          var falseBranch = [];
          this.parseConditionalExpression(trueBranch);
          this.expect(TOP, ":");
          this.parseConditionalExpression(falseBranch);
          instr.push(new Instruction(IEXPR, trueBranch));
          instr.push(new Instruction(IEXPR, falseBranch));
          instr.push(ternaryInstruction("?"));
        }
      };
      ParserState.prototype.parseOrExpression = function(instr) {
        this.parseAndExpression(instr);
        while (this.accept(TOP, "or")) {
          var falseBranch = [];
          this.parseAndExpression(falseBranch);
          instr.push(new Instruction(IEXPR, falseBranch));
          instr.push(binaryInstruction("or"));
        }
      };
      ParserState.prototype.parseAndExpression = function(instr) {
        this.parseComparison(instr);
        while (this.accept(TOP, "and")) {
          var trueBranch = [];
          this.parseComparison(trueBranch);
          instr.push(new Instruction(IEXPR, trueBranch));
          instr.push(binaryInstruction("and"));
        }
      };
      var COMPARISON_OPERATORS = ["==", "!=", "<", "<=", ">=", ">", "in"];
      ParserState.prototype.parseComparison = function(instr) {
        this.parseAddSub(instr);
        while (this.accept(TOP, COMPARISON_OPERATORS)) {
          var op = this.current;
          this.parseAddSub(instr);
          instr.push(binaryInstruction(op.value));
        }
      };
      var ADD_SUB_OPERATORS = ["+", "-", "||"];
      ParserState.prototype.parseAddSub = function(instr) {
        this.parseTerm(instr);
        while (this.accept(TOP, ADD_SUB_OPERATORS)) {
          var op = this.current;
          this.parseTerm(instr);
          instr.push(binaryInstruction(op.value));
        }
      };
      var TERM_OPERATORS = ["*", "/", "%"];
      ParserState.prototype.parseTerm = function(instr) {
        this.parseFactor(instr);
        while (this.accept(TOP, TERM_OPERATORS)) {
          var op = this.current;
          this.parseFactor(instr);
          instr.push(binaryInstruction(op.value));
        }
      };
      ParserState.prototype.parseFactor = function(instr) {
        var unaryOps = this.tokens.unaryOps;
        function isPrefixOperator(token) {
          return token.value in unaryOps;
        }
        this.save();
        if (this.accept(TOP, isPrefixOperator)) {
          if (this.current.value !== "-" && this.current.value !== "+") {
            if (this.nextToken.type === TPAREN && this.nextToken.value === "(") {
              this.restore();
              this.parseExponential(instr);
              return;
            } else if (this.nextToken.type === TSEMICOLON || this.nextToken.type === TCOMMA || this.nextToken.type === TEOF || this.nextToken.type === TPAREN && this.nextToken.value === ")") {
              this.restore();
              this.parseAtom(instr);
              return;
            }
          }
          var op = this.current;
          this.parseFactor(instr);
          instr.push(unaryInstruction(op.value));
        } else {
          this.parseExponential(instr);
        }
      };
      ParserState.prototype.parseExponential = function(instr) {
        this.parsePostfixExpression(instr);
        while (this.accept(TOP, "^")) {
          this.parseFactor(instr);
          instr.push(binaryInstruction("^"));
        }
      };
      ParserState.prototype.parsePostfixExpression = function(instr) {
        this.parseFunctionCall(instr);
        while (this.accept(TOP, "!")) {
          instr.push(unaryInstruction("!"));
        }
      };
      ParserState.prototype.parseFunctionCall = function(instr) {
        var unaryOps = this.tokens.unaryOps;
        function isPrefixOperator(token) {
          return token.value in unaryOps;
        }
        if (this.accept(TOP, isPrefixOperator)) {
          var op = this.current;
          this.parseAtom(instr);
          instr.push(unaryInstruction(op.value));
        } else {
          this.parseMemberExpression(instr);
          while (this.accept(TPAREN, "(")) {
            if (this.accept(TPAREN, ")")) {
              instr.push(new Instruction(IFUNCALL, 0));
            } else {
              var argCount = this.parseArgumentList(instr);
              instr.push(new Instruction(IFUNCALL, argCount));
            }
          }
        }
      };
      ParserState.prototype.parseArgumentList = function(instr) {
        var argCount = 0;
        while (!this.accept(TPAREN, ")")) {
          this.parseExpression(instr);
          ++argCount;
          while (this.accept(TCOMMA)) {
            this.parseExpression(instr);
            ++argCount;
          }
        }
        return argCount;
      };
      ParserState.prototype.parseMemberExpression = function(instr) {
        this.parseAtom(instr);
        while (this.accept(TOP, ".") || this.accept(TBRACKET, "[")) {
          var op = this.current;
          if (op.value === ".") {
            if (!this.allowMemberAccess) {
              throw new Error('unexpected ".", member access is not permitted');
            }
            this.expect(TNAME);
            instr.push(new Instruction(IMEMBER, this.current.value));
          } else if (op.value === "[") {
            if (!this.tokens.isOperatorEnabled("[")) {
              throw new Error('unexpected "[]", arrays are disabled');
            }
            this.parseExpression(instr);
            this.expect(TBRACKET, "]");
            instr.push(binaryInstruction("["));
          } else {
            throw new Error("unexpected symbol: " + op.value);
          }
        }
      };
      function add(a, b) {
        return Number(a) + Number(b);
      }
      function sub(a, b) {
        return a - b;
      }
      function mul(a, b) {
        return a * b;
      }
      function div(a, b) {
        return a / b;
      }
      function mod(a, b) {
        return a % b;
      }
      function concat(a, b) {
        if (Array.isArray(a) && Array.isArray(b)) {
          return a.concat(b);
        }
        return "" + a + b;
      }
      function equal(a, b) {
        return a === b;
      }
      function notEqual(a, b) {
        return a !== b;
      }
      function greaterThan(a, b) {
        return a > b;
      }
      function lessThan(a, b) {
        return a < b;
      }
      function greaterThanEqual(a, b) {
        return a >= b;
      }
      function lessThanEqual(a, b) {
        return a <= b;
      }
      function andOperator(a, b) {
        return Boolean(a && b);
      }
      function orOperator(a, b) {
        return Boolean(a || b);
      }
      function inOperator(a, b) {
        return contains(b, a);
      }
      function sinh(a) {
        return (Math.exp(a) - Math.exp(-a)) / 2;
      }
      function cosh(a) {
        return (Math.exp(a) + Math.exp(-a)) / 2;
      }
      function tanh(a) {
        if (a === Infinity) return 1;
        if (a === -Infinity) return -1;
        return (Math.exp(a) - Math.exp(-a)) / (Math.exp(a) + Math.exp(-a));
      }
      function asinh(a) {
        if (a === -Infinity) return a;
        return Math.log(a + Math.sqrt(a * a + 1));
      }
      function acosh(a) {
        return Math.log(a + Math.sqrt(a * a - 1));
      }
      function atanh(a) {
        return Math.log((1 + a) / (1 - a)) / 2;
      }
      function log10(a) {
        return Math.log(a) * Math.LOG10E;
      }
      function neg(a) {
        return -a;
      }
      function not(a) {
        return !a;
      }
      function trunc(a) {
        return a < 0 ? Math.ceil(a) : Math.floor(a);
      }
      function random(a) {
        return Math.random() * (a || 1);
      }
      function factorial(a) {
        return gamma(a + 1);
      }
      function isInteger(value) {
        return isFinite(value) && value === Math.round(value);
      }
      var GAMMA_G = 4.7421875;
      var GAMMA_P = [
        0.9999999999999971,
        57.15623566586292,
        -59.59796035547549,
        14.136097974741746,
        -0.4919138160976202,
        3399464998481189e-20,
        4652362892704858e-20,
        -9837447530487956e-20,
        1580887032249125e-19,
        -21026444172410488e-20,
        21743961811521265e-20,
        -1643181065367639e-19,
        8441822398385275e-20,
        -26190838401581408e-21,
        36899182659531625e-22
      ];
      function gamma(n) {
        var t, x;
        if (isInteger(n)) {
          if (n <= 0) {
            return isFinite(n) ? Infinity : NaN;
          }
          if (n > 171) {
            return Infinity;
          }
          var value = n - 2;
          var res = n - 1;
          while (value > 1) {
            res *= value;
            value--;
          }
          if (res === 0) {
            res = 1;
          }
          return res;
        }
        if (n < 0.5) {
          return Math.PI / (Math.sin(Math.PI * n) * gamma(1 - n));
        }
        if (n >= 171.35) {
          return Infinity;
        }
        if (n > 85) {
          var twoN = n * n;
          var threeN = twoN * n;
          var fourN = threeN * n;
          var fiveN = fourN * n;
          return Math.sqrt(2 * Math.PI / n) * Math.pow(n / Math.E, n) * (1 + 1 / (12 * n) + 1 / (288 * twoN) - 139 / (51840 * threeN) - 571 / (2488320 * fourN) + 163879 / (209018880 * fiveN) + 5246819 / (75246796800 * fiveN * n));
        }
        --n;
        x = GAMMA_P[0];
        for (var i = 1; i < GAMMA_P.length; ++i) {
          x += GAMMA_P[i] / (n + i);
        }
        t = n + GAMMA_G + 0.5;
        return Math.sqrt(2 * Math.PI) * Math.pow(t, n + 0.5) * Math.exp(-t) * x;
      }
      function stringOrArrayLength(s) {
        if (Array.isArray(s)) {
          return s.length;
        }
        return String(s).length;
      }
      function hypot() {
        var sum = 0;
        var larg = 0;
        for (var i = 0; i < arguments.length; i++) {
          var arg = Math.abs(arguments[i]);
          var div2;
          if (larg < arg) {
            div2 = larg / arg;
            sum = sum * div2 * div2 + 1;
            larg = arg;
          } else if (arg > 0) {
            div2 = arg / larg;
            sum += div2 * div2;
          } else {
            sum += arg;
          }
        }
        return larg === Infinity ? Infinity : larg * Math.sqrt(sum);
      }
      function condition(cond, yep, nope) {
        return cond ? yep : nope;
      }
      function roundTo(value, exp) {
        if (typeof exp === "undefined" || +exp === 0) {
          return Math.round(value);
        }
        value = +value;
        exp = -+exp;
        if (isNaN(value) || !(typeof exp === "number" && exp % 1 === 0)) {
          return NaN;
        }
        value = value.toString().split("e");
        value = Math.round(+(value[0] + "e" + (value[1] ? +value[1] - exp : -exp)));
        value = value.toString().split("e");
        return +(value[0] + "e" + (value[1] ? +value[1] + exp : exp));
      }
      function setVar(name, value, variables) {
        if (variables) variables[name] = value;
        return value;
      }
      function arrayIndex(array, index2) {
        return array[index2 | 0];
      }
      function max(array) {
        if (arguments.length === 1 && Array.isArray(array)) {
          return Math.max.apply(Math, array);
        } else {
          return Math.max.apply(Math, arguments);
        }
      }
      function min(array) {
        if (arguments.length === 1 && Array.isArray(array)) {
          return Math.min.apply(Math, array);
        } else {
          return Math.min.apply(Math, arguments);
        }
      }
      function arrayMap(f, a) {
        if (typeof f !== "function") {
          throw new Error("First argument to map is not a function");
        }
        if (!Array.isArray(a)) {
          throw new Error("Second argument to map is not an array");
        }
        return a.map(function(x, i) {
          return f(x, i);
        });
      }
      function arrayFold(f, init, a) {
        if (typeof f !== "function") {
          throw new Error("First argument to fold is not a function");
        }
        if (!Array.isArray(a)) {
          throw new Error("Second argument to fold is not an array");
        }
        return a.reduce(function(acc, x, i) {
          return f(acc, x, i);
        }, init);
      }
      function arrayFilter(f, a) {
        if (typeof f !== "function") {
          throw new Error("First argument to filter is not a function");
        }
        if (!Array.isArray(a)) {
          throw new Error("Second argument to filter is not an array");
        }
        return a.filter(function(x, i) {
          return f(x, i);
        });
      }
      function stringOrArrayIndexOf(target, s) {
        if (!(Array.isArray(s) || typeof s === "string")) {
          throw new Error("Second argument to indexOf is not a string or array");
        }
        return s.indexOf(target);
      }
      function arrayJoin(sep, a) {
        if (!Array.isArray(a)) {
          throw new Error("Second argument to join is not an array");
        }
        return a.join(sep);
      }
      function sign(x) {
        return (x > 0) - (x < 0) || +x;
      }
      var ONE_THIRD = 1 / 3;
      function cbrt(x) {
        return x < 0 ? -Math.pow(-x, ONE_THIRD) : Math.pow(x, ONE_THIRD);
      }
      function expm1(x) {
        return Math.exp(x) - 1;
      }
      function log1p(x) {
        return Math.log(1 + x);
      }
      function log2(x) {
        return Math.log(x) / Math.LN2;
      }
      function Parser2(options) {
        this.options = options || {};
        this.unaryOps = {
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          asin: Math.asin,
          acos: Math.acos,
          atan: Math.atan,
          sinh: Math.sinh || sinh,
          cosh: Math.cosh || cosh,
          tanh: Math.tanh || tanh,
          asinh: Math.asinh || asinh,
          acosh: Math.acosh || acosh,
          atanh: Math.atanh || atanh,
          sqrt: Math.sqrt,
          cbrt: Math.cbrt || cbrt,
          log: Math.log,
          log2: Math.log2 || log2,
          ln: Math.log,
          lg: Math.log10 || log10,
          log10: Math.log10 || log10,
          expm1: Math.expm1 || expm1,
          log1p: Math.log1p || log1p,
          abs: Math.abs,
          ceil: Math.ceil,
          floor: Math.floor,
          round: Math.round,
          trunc: Math.trunc || trunc,
          "-": neg,
          "+": Number,
          exp: Math.exp,
          not,
          length: stringOrArrayLength,
          "!": factorial,
          sign: Math.sign || sign
        };
        this.binaryOps = {
          "+": add,
          "-": sub,
          "*": mul,
          "/": div,
          "%": mod,
          "^": Math.pow,
          "||": concat,
          "==": equal,
          "!=": notEqual,
          ">": greaterThan,
          "<": lessThan,
          ">=": greaterThanEqual,
          "<=": lessThanEqual,
          and: andOperator,
          or: orOperator,
          "in": inOperator,
          "=": setVar,
          "[": arrayIndex
        };
        this.ternaryOps = {
          "?": condition
        };
        this.functions = {
          random,
          fac: factorial,
          min,
          max,
          hypot: Math.hypot || hypot,
          pyt: Math.hypot || hypot,
          // backward compat
          pow: Math.pow,
          atan2: Math.atan2,
          "if": condition,
          gamma,
          roundTo,
          map: arrayMap,
          fold: arrayFold,
          filter: arrayFilter,
          indexOf: stringOrArrayIndexOf,
          join: arrayJoin
        };
        this.consts = {
          E: Math.E,
          PI: Math.PI,
          "true": true,
          "false": false
        };
      }
      Parser2.prototype.parse = function(expr) {
        var instr = [];
        var parserState = new ParserState(
          this,
          new TokenStream(this, expr),
          { allowMemberAccess: this.options.allowMemberAccess }
        );
        parserState.parseExpression(instr);
        parserState.expect(TEOF, "EOF");
        return new Expression(instr, this);
      };
      Parser2.prototype.evaluate = function(expr, variables) {
        return this.parse(expr).evaluate(variables);
      };
      var sharedParser = new Parser2();
      Parser2.parse = function(expr) {
        return sharedParser.parse(expr);
      };
      Parser2.evaluate = function(expr, variables) {
        return sharedParser.parse(expr).evaluate(variables);
      };
      var optionNameMap = {
        "+": "add",
        "-": "subtract",
        "*": "multiply",
        "/": "divide",
        "%": "remainder",
        "^": "power",
        "!": "factorial",
        "<": "comparison",
        ">": "comparison",
        "<=": "comparison",
        ">=": "comparison",
        "==": "comparison",
        "!=": "comparison",
        "||": "concatenate",
        "and": "logical",
        "or": "logical",
        "not": "logical",
        "?": "conditional",
        ":": "conditional",
        "=": "assignment",
        "[": "array",
        "()=": "fndef"
      };
      function getOptionName(op) {
        return optionNameMap.hasOwnProperty(op) ? optionNameMap[op] : op;
      }
      Parser2.prototype.isOperatorEnabled = function(op) {
        var optionName = getOptionName(op);
        var operators = this.options.operators || {};
        return !(optionName in operators) || !!operators[optionName];
      };
      var index = {
        Parser: Parser2,
        Expression
      };
      exports2.Expression = Expression;
      exports2.Parser = Parser2;
      exports2.default = index;
      Object.defineProperty(exports2, "__esModule", { value: true });
    });
  }
});

// src/adapter/workspace.ts
var workspace_exports = {};
__export(workspace_exports, {
  dagFlowDir: () => dagFlowDir,
  dagFlowLogsDir: () => dagFlowLogsDir,
  dagFlowScriptsDir: () => dagFlowScriptsDir,
  dagFlowTmpDir: () => dagFlowTmpDir,
  ensureDagFlowDirs: () => ensureDagFlowDirs,
  workspaceRoot: () => workspaceRoot
});
import { promises as fs4 } from "node:fs";
import * as path5 from "node:path";
async function workspaceRoot() {
  if (cachedRoot) return cachedRoot;
  const info = await resolveStorageRoot();
  cachedRoot = path5.dirname(path5.dirname(info.dir));
  return cachedRoot;
}
async function dagFlowDir() {
  const info = await resolveStorageRoot();
  return path5.dirname(info.dir);
}
async function ensureDagFlowDirs() {
  if (!ensured) {
    ensured = (async () => {
      const root = await dagFlowDir();
      await fs4.mkdir(path5.join(root, "tmp"), { recursive: true });
      await fs4.mkdir(path5.join(root, "logs"), { recursive: true });
      await fs4.mkdir(path5.join(root, "scripts"), { recursive: true });
    })().catch(() => {
    });
  }
  return ensured;
}
async function dagFlowScriptsDir() {
  await ensureDagFlowDirs();
  return path5.join(await dagFlowDir(), "scripts");
}
async function dagFlowTmpDir() {
  await ensureDagFlowDirs();
  return path5.join(await dagFlowDir(), "tmp");
}
async function dagFlowLogsDir() {
  await ensureDagFlowDirs();
  return path5.join(await dagFlowDir(), "logs");
}
var cachedRoot, ensured;
var init_workspace = __esm({
  "src/adapter/workspace.ts"() {
    "use strict";
    init_storage();
    cachedRoot = null;
    ensured = null;
  }
});

// src/adapter/logger.ts
var logger_exports = {};
__export(logger_exports, {
  createLogger: () => createLogger
});
import { appendFile } from "node:fs/promises";
import * as path7 from "node:path";
function consoleOut(level, msg, meta) {
  const tag = `[dag-flow]`;
  const line = meta && Object.keys(meta).length ? `${msg} ${JSON.stringify(meta)}` : msg;
  console[level](`${tag} ${line}`);
}
function todayLogPath() {
  const d = /* @__PURE__ */ new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `dag-flow-${y}-${m}-${day}.log`;
}
function cstStamp(d = /* @__PURE__ */ new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1e3);
  return t.toISOString().replace("T", " ").replace("Z", "");
}
function appendToLogFile(level, line) {
  const stamp = cstStamp();
  const text = `${stamp} [${level.toUpperCase()}] ${line}
`;
  void dagFlowLogsDir().then((dir) => appendFile(path7.join(dir, todayLogPath()), text, "utf8")).catch(() => {
  });
}
function createLogger() {
  const hostLogger = hostService("logger");
  const emit = (level, hostFn, msg, meta) => {
    const line = meta && Object.keys(meta).length ? `${msg} ${JSON.stringify(meta)}` : msg;
    appendToLogFile(level, line);
    if (!hostFn) {
      consoleOut(level, msg, meta);
      return;
    }
    try {
      hostFn.call(hostLogger, msg, meta);
    } catch (e) {
      consoleOut(level, `${msg} (logger call failed: ${e.message})`, meta);
    }
  };
  return {
    info(msg, meta) {
      emit("info", hostLogger?.info, msg, meta);
    },
    warn(msg, meta) {
      emit("warn", hostLogger?.warn, msg, meta);
    },
    error(msg, meta) {
      emit("error", hostLogger?.error, msg, meta);
    }
  };
}
var init_logger = __esm({
  "src/adapter/logger.ts"() {
    "use strict";
    init_safety();
    init_workspace();
  }
});

// tmp-test/run-simple-workflow.mjs
init_run();

// src/registry/builtin.ts
init_external();
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join as join8, dirname as dirname5, isAbsolute as isAbsolute2 } from "node:path";

// src/registry/expr.ts
var import_expr_eval = __toESM(require_bundle(), 1);
var parser = new import_expr_eval.Parser({
  operators: {
    in: false,
    notin: false,
    assignment: false,
    logical: true,
    comparison: true,
    // 允许安全的成员访问（ctx.x）
    concat: false
  }
});
var EXP = /* @__PURE__ */ new Set(["Math", "Number", "String", "Boolean", "Array", "Object", "JSON", "Date"]);
var ExprError = class extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ExprError";
  }
};
function evaluateExpr(expr, scope) {
  let parsed;
  try {
    parsed = parser.parse(expr);
  } catch (e) {
    throw new ExprError(`\u8868\u8FBE\u5F0F\u89E3\u6790\u5931\u8D25: ${e.message} | \u8868\u8FBE\u5F0F: ${expr}`);
  }
  for (const k of Object.keys(scope)) {
    if (!EXP.has(k) && typeof scope[k] === "object" && scope[k] !== null) {
      if (typeof scope[k][k] === "function") {
        throw new ExprError(`\u4F5C\u7528\u57DF ${k} \u4E2D\u7684\u51FD\u6570\u5F15\u7528\u4E0D\u88AB\u5141\u8BB8`);
      }
    }
  }
  try {
    return parsed.evaluate({
      ...scope,
      // 显式白名单
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      JSON,
      Date
    });
  } catch (e) {
    throw new ExprError(`\u8868\u8FBE\u5F0F\u6C42\u503C\u5931\u8D25: ${e.message} | \u8868\u8FBE\u5F0F: ${expr}`);
  }
}
function evaluateBool(expr, scope) {
  const v = evaluateExpr(expr, scope);
  if (typeof v === "number" && Number.isNaN(v)) {
    console.warn(`[dag-flow] \u6761\u4EF6\u8868\u8FBE\u5F0F\u7ED3\u679C\u4E3A NaN\uFF0C\u5DF2\u6309 false \u5904\u7406: ${expr}\u2014\u2014\u5E38\u89C1\u539F\u56E0\uFF1A\u8868\u8FBE\u5F0F\u91CC\u5199\u4E86\u6A21\u677F\u5F0F\u7684 node.out / results.<id>.out\uFF1B\u8868\u8FBE\u5F0F\u4F5C\u7528\u57DF\u4E2D\u8282\u70B9\u8F93\u51FA\u6309 <\u8282\u70B9id> \u76F4\u63A5\u53D6\uFF08\u5BF9\u8C61\u578B out \u518D\u53D6\u5B57\u6BB5\uFF0C\u5982 ws.count\uFF09\uFF0C\u6216\u7528 results.<id> \u547D\u540D\u7A7A\u95F4`);
  } else if (v === false && /[A-Za-z0-9_\])]\.out\b/.test(expr)) {
    console.warn(`[dag-flow] \u6761\u4EF6\u8868\u8FBE\u5F0F\u542B ".out" \u4E14\u7ED3\u679C\u4E3A false\u2014\u2014\u8868\u8FBE\u5F0F\u4F5C\u7528\u57DF\u6CA1\u6709 ".out" \u5199\u6CD5\uFF08\u8282\u70B9\u8F93\u51FA\u6309 <\u8282\u70B9id> \u62CD\u5E73\u53D6\u503C\uFF0C\u6216\u7528 results.<id> \u547D\u540D\u7A7A\u95F4\uFF09\uFF0C\u7591\u4F3C\u7B14\u8BEF\uFF0C\u5DF2\u6309 false \u5904\u7406: ${expr}`);
  }
  return Boolean(v);
}

// src/adapter/fetch-errors.ts
function humanizeFetchError(e) {
  const err = e;
  const msg = err?.message ?? String(e);
  if (err?.name === "AbortError") return "\u8BF7\u6C42\u5DF2\u8D85\u65F6\u4E2D\u65AD";
  if (/Failed to parse URL|Invalid URL/i.test(msg)) {
    return `URL \u683C\u5F0F\u4E0D\u5408\u6CD5\uFF08\u68C0\u67E5\u662F\u5426\u6F0F\u4E86 http:// \u6216 https:// \u524D\u7F00\u3001\u662F\u5426\u6709\u591A\u4F59\u7A7A\u683C\uFF09: ${msg}`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|certificate|SSL|TLS/i.test(msg)) {
    return `\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF08\u65E0\u6CD5\u8BBF\u95EE\u76EE\u6807\u5730\u5740\u2014\u2014\u68C0\u67E5 URL \u662F\u5426\u6B63\u786E\u3001\u7F51\u7EDC/\u4EE3\u7406/\u9632\u706B\u5899\u662F\u5426\u653E\u884C\u3001\u76EE\u6807\u670D\u52A1\u662F\u5426\u5728\u7EBF\uFF09: ${msg}`;
  }
  return `\u8BF7\u6C42\u5F02\u5E38: ${msg}`;
}

// src/dsh-gate/llm.ts
init_host();
function hostLlm() {
  return hostService("llm");
}

// src/dsh-gate/llm-config.ts
import { promises as fs2 } from "node:fs";

// src/adapter/yaml-lite.ts
function parse(yaml) {
  const lines = yaml.split(/\r?\n/);
  const firstMeaningful = lines.find((l) => l.trim() && !l.trim().startsWith("#"));
  const rootIsArray = !!firstMeaningful && firstMeaningful.trim().startsWith("- ");
  const root = rootIsArray ? [] : {};
  const stack = [{ indent: -1, container: root, isArray: rootIsArray }];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      const rest = trimmed.slice(2).trim();
      const colonIdx2 = findColon(rest);
      let arr;
      if (parent.isArray) {
        arr = parent.container;
      } else if (parent.lastKey) {
        arr = [];
        parent.container[parent.lastKey] = arr;
        parent.container = arr;
        parent.isArray = true;
      } else if (parent.parentContainer && parent.parentKey) {
        arr = [];
        parent.parentContainer[parent.parentKey] = arr;
        parent.container = arr;
        parent.isArray = true;
      } else {
        continue;
      }
      const obj = {};
      if (colonIdx2 >= 0) {
        const key2 = rest.slice(0, colonIdx2).trim().replace(/^['"]|['"]$/g, "");
        const rawVal2 = rest.slice(colonIdx2 + 1).trim();
        if (rawVal2 === "") {
          arr.push(obj);
          stack.push({ indent, container: obj, isArray: false, parentContainer: arr, parentKey: void 0 });
        } else {
          obj[key2] = parseScalar(rawVal2);
          arr.push(obj);
          stack.push({ indent, container: obj, isArray: false });
        }
        parent.lastKey = key2;
      } else {
        arr.push(parseScalar(rest));
      }
      continue;
    }
    const colonIdx = findColon(trimmed);
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, "");
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    if (!parent.isArray && parent.container) {
      const obj = parent.container;
      if (rawVal === "" || rawVal === "|" || rawVal === ">") {
        const child = {};
        obj[key] = child;
        stack.push({ indent, container: child, isArray: false, parentContainer: obj, parentKey: key });
      } else {
        obj[key] = parseScalar(rawVal);
        parent.lastKey = key;
      }
    }
  }
  return rootIsArray ? root : root;
}
function findColon(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":" && (i + 1 >= s.length || s[i + 1] === " " || s[i + 1] === "	")) return i;
  }
  return -1;
}
function parseScalar(raw) {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\n/g, "\n");
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

// src/dsh-gate/llm-config.ts
init_paths();
var SETTINGS_PATH = settingsYamlPath();
var CREDENTIALS_PATH = credentialsYamlPath();
var SETTINGS_KEY_PI = "llm-pi-ai";
var SETTINGS_KEY_DEEPSEEK = "llm-deepseek";
var SETTINGS_KEY_DEFAULT_MODEL = "agent-default-model";
var CREDENTIALS_KEY_REFS = "refs";
async function readLlmConfigFiles() {
  let settings = {};
  let creds = {};
  try {
    settings = parse(await fs2.readFile(SETTINGS_PATH, "utf8"));
  } catch {
  }
  try {
    creds = parse(await fs2.readFile(CREDENTIALS_PATH, "utf8"));
  } catch {
  }
  const patch = await readProfilePatchSettings();
  for (const [k, v] of Object.entries(patch)) {
    if (settings[k] === void 0) settings[k] = v;
  }
  return { settings, creds };
}
async function readProfilePatchSettings() {
  const out = {};
  const wanted = /* @__PURE__ */ new Set([SETTINGS_KEY_PI, SETTINGS_KEY_DEEPSEEK, SETTINGS_KEY_DEFAULT_MODEL]);
  let profiles = [];
  try {
    profiles = (await fs2.readdir(profilesDir(), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const p of profiles) {
    let raw;
    try {
      raw = await fs2.readFile(profilePatchPath(p), "utf8");
    } catch {
      continue;
    }
    let doc;
    try {
      doc = parse(raw);
    } catch {
      continue;
    }
    const entries = Array.isArray(doc) ? doc : [];
    for (const entry of entries) {
      const e = entry;
      if (!e || typeof e !== "object" || !e.id || !wanted.has(e.id)) continue;
      if (e.config && typeof e.config === "object" && out[e.id] === void 0) {
        out[e.id] = e.config;
      }
    }
  }
  return out;
}
function keyFor(credRefs, envName) {
  if (!envName) return "";
  if (credRefs[envName]) return credRefs[envName];
  if (process.env[envName]) return process.env[envName];
  return "";
}
function readInput(m) {
  const input = m?.input;
  if (Array.isArray(input) && input.length > 0 && input.every((x) => typeof x === "string")) {
    const arr = input;
    return arr.includes("text") ? arr : ["text", ...arr];
  }
  return ["text"];
}
function buildLlmCandidates(settings, creds) {
  const credRefs = creds?.[CREDENTIALS_KEY_REFS] ?? {};
  const candidates = [];
  const pi = settings?.[SETTINGS_KEY_PI] ?? {};
  for (const [pid, pv] of Object.entries(pi.providers ?? {})) {
    const prov = pv;
    const baseURL = String(prov.baseURL ?? "");
    const apiKey = keyFor(credRefs, prov.apiKeyEnv);
    const api = String(prov.api ?? "").trim().toLowerCase();
    const needsHost = api !== "" && !api.startsWith("openai");
    const models = Array.isArray(prov.models) ? prov.models : prov.models && typeof prov.models === "object" ? Object.values(prov.models) : [];
    for (const m of models) {
      const modelId = m?.id ?? m?.name;
      if (modelId) {
        const rawName = m?.name;
        const modelLabel = typeof rawName === "string" && rawName && rawName !== modelId ? rawName : void 0;
        candidates.push({
          baseURL,
          apiKey,
          model: modelId,
          providerName: `${pid}:${modelId}`,
          input: readInput(m),
          // providerLabel = provider 键名：同名模型消歧时显示它（比内部串 `pid:model` 好认）
          providerLabel: pid,
          ...modelLabel ? { modelLabel } : {},
          ...needsHost ? { viaHost: true, hostProvider: pid } : {}
        });
      }
    }
  }
  const ds = settings?.[SETTINGS_KEY_DEEPSEEK] ?? {};
  if (ds.baseURL) {
    const adm = settings?.[SETTINGS_KEY_DEFAULT_MODEL] ?? {};
    candidates.push({
      baseURL: String(ds.baseURL),
      apiKey: keyFor(credRefs, "DEEPSEEK_API_KEY") || keyFor(credRefs, "ARK_CODE_LATEST_API_KEY"),
      model: adm.model ?? "deepseek-chat",
      providerName: "llm-deepseek",
      providerLabel: "llm-deepseek",
      input: ["text"]
    });
  }
  return candidates;
}
var ENV_LLM_BASEURL = "DAG_FLOW_LLM_BASEURL";
var ENV_LLM_KEY = "DAG_FLOW_LLM_KEY";
var ENV_LLM_MODEL = "DAG_FLOW_LLM_MODEL";
function envFallbackEndpoint() {
  const baseURL = process.env[ENV_LLM_BASEURL];
  if (!baseURL) return null;
  return {
    baseURL: String(baseURL).replace(/\/+$/, ""),
    apiKey: process.env[ENV_LLM_KEY] ?? "",
    model: process.env[ENV_LLM_MODEL] || "deepseek-chat",
    providerName: "env-fallback",
    input: ["text"]
  };
}

// src/adapter/subagent.ts
var DEFAULT_TIMEOUT_MS = 12e4;
var SubagentUnavailableError = class extends Error {
  /** 可选的节点级错误码：同一种病在不同路径要报同一个码（如空输出 SUBAGENT_EMPTY_OUTPUT），
   *  否则「host 路径 vs 直连路径」会给出不同 code（2026-10-03 契约测试 E1 暴露）。 */
  code;
  constructor(reason, code) {
    super(`subagent unavailable: ${reason}`);
    this.name = "SubagentUnavailableError";
    if (code) this.code = code;
  }
};
var MODALITY_EXTS = {
  image: /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)\b/gi,
  video: /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)\b/gi,
  file: /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/gi
};
function detectModalities(text) {
  const out = /* @__PURE__ */ new Set();
  for (const [modality, re] of Object.entries(MODALITY_EXTS)) {
    re.lastIndex = 0;
    if (re.test(String(text))) out.add(modality);
  }
  return [...out];
}
function checkModelModality(endpoint, prompt) {
  const needed = detectModalities(prompt);
  if (needed.length === 0) return null;
  const caps = endpoint.input?.length ? endpoint.input : ["text"];
  const missing = needed.filter((m) => !caps.includes(m));
  if (missing.length === 0) return null;
  const label = { image: "\u56FE\u7247", video: "\u89C6\u9891", file: "\u6587\u4EF6" };
  const missingLabel = missing.map((m) => label[m] ?? m).join("\u3001");
  const suggest = missing.includes("image") ? "\uFF08\u5982 dsh:custom-model:kimi-k3 / minimax-m3\uFF09" : "";
  return `\u6240\u9009\u6A21\u578B ${endpoint.modelLabel ?? endpoint.providerName ?? endpoint.model} \u4E0D\u652F\u6301${missingLabel}\u8F93\u5165\uFF08\u80FD\u529B: ${caps.join(", ")}\uFF09\u2014\u2014prompt \u4E2D\u5F15\u7528\u4E86${missingLabel}\u6587\u4EF6\u3002\u8BF7\u6362\u652F\u6301\u5BF9\u5E94\u6A21\u6001\u7684\u6A21\u578B${suggest}\uFF0C\u6216\u5728 dsh settings.yaml \u4E3A\u8BE5\u6A21\u578B\u6807\u6CE8 input: [text, image]`;
}
function parseOpenAICompat(endpoint) {
  const base = String(endpoint.baseURL ?? "").replace(/\/+$/, "");
  return { baseURL: base, apiKey: endpoint.apiKey, model: endpoint.model };
}
var _structureWarned = false;
async function listAllEndpoints() {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const dedupeKey = (name) => name.replace(/^llm:/, "");
  try {
    const llm = hostLlm();
    if (llm && typeof llm.listProviders === "function" && typeof llm.listModels === "function") {
      for (const p of await llm.listProviders()) {
        if (!p?.id) continue;
        try {
          for (const m of await llm.listModels(p.id)) {
            if (!m?.id) continue;
            const name = `llm:${p.id}:${m.id}`;
            const key = dedupeKey(name);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              baseURL: "",
              apiKey: "",
              model: m.id,
              providerName: name,
              // ★ 显示名（2026-10-03）：只给 UI 用，存值/路由仍是 providerName + model
              modelLabel: typeof m.name === "string" && m.name ? m.name : void 0,
              providerLabel: typeof p.name === "string" && p.name ? p.name : void 0,
              input: Array.isArray(m.inputModalities) && m.inputModalities.length > 0 ? m.inputModalities.includes("text") ? [...m.inputModalities] : ["text", ...m.inputModalities] : ["text"],
              viaHost: true,
              hostProvider: p.id
            });
          }
        } catch {
        }
      }
    }
  } catch {
  }
  const { settings, creds } = await readLlmConfigFiles();
  try {
    for (const ep of buildLlmCandidates(settings, creds)) {
      const name = ep.providerName ?? `${ep.model}`;
      const key = dedupeKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ep);
    }
  } catch {
  }
  if (!_structureWarned && settings[SETTINGS_KEY_PI] != null && out.length === 0) {
    _structureWarned = true;
    console.warn("[dag-flow] dsh \u914D\u7F6E\uFF08settings.yaml / profile cordis.patch.yml\uFF09\u5B58\u5728 llm-pi-ai \u6BB5\uFF0C\u4F46\u672A\u89E3\u6790\u51FA\u4EFB\u4F55\u53EF\u7528\u6A21\u578B\u2014\u2014dsh \u7684\u914D\u7F6E\u7ED3\u6784\u53EF\u80FD\u5DF2\u53D8\u5316\u3002\u8BF7\u68C0\u67E5 llm-pi-ai.providers[*].models \u7684\u5B57\u6BB5\u5F62\u6001\uFF08id/name\uFF09\uFF0C\u6216\u628A\u914D\u7F6E\u6587\u4EF6\u53D1\u7ED9 dag-flow \u7EF4\u62A4\u8005\u9002\u914D\u65B0\u7ED3\u6784");
  }
  const envEp = envFallbackEndpoint();
  if (envEp && !seen.has(dedupeKey(envEp.providerName ?? ""))) out.push(envEp);
  return out;
}
async function resolveLlmEndpoint(modelId) {
  if (modelId) {
    try {
      const all = await listAllEndpoints();
      const named = (e) => e.providerName === modelId || `dsh:${e.providerName}` === modelId || `dsh:${e.model}` === modelId;
      const hostHit = all.find((e) => e.viaHost === true && (named(e) || e.model === modelId));
      if (hostHit) return hostHit;
      const cfgHit = all.find((e) => !e.viaHost && named(e));
      if (cfgHit && cfgHit.baseURL && cfgHit.model) return cfgHit;
      const bareHit = all.find((e) => !e.viaHost && e.model === modelId);
      if (bareHit && bareHit.baseURL) return bareHit;
      throw new SubagentUnavailableError(`\u672A\u627E\u5230\u6A21\u578B "${modelId}"\u2014\u2014\u8BF7\u6253\u5F00\u8282\u70B9\u300C\u9009\u62E9\u6A21\u578B\u300D\u4ECE dsh \u5F53\u524D\u53EF\u7528\u6A21\u578B\u4E2D\u91CD\u65B0\u9009\u62E9`);
    } catch (e) {
      if (e instanceof SubagentUnavailableError) throw e;
    }
  }
  const { settings, creds } = await readLlmConfigFiles();
  const candidates = buildLlmCandidates(settings, creds);
  const usable = candidates.find((c) => c.baseURL && c.apiKey) ?? candidates.find((c) => c.baseURL);
  if (usable) return usable;
  const envEp = envFallbackEndpoint();
  if (envEp) return envEp;
  throw new SubagentUnavailableError("dsh \u914D\u7F6E\uFF08settings.yaml / profile cordis.patch.yml\uFF09\u4E2D\u6CA1\u6709\u53EF\u7528\u7684 LLM \u7AEF\u70B9\uFF08\u53EF\u8BBE DAG_FLOW_LLM_BASEURL / DAG_FLOW_LLM_KEY / DAG_FLOW_LLM_MODEL \u73AF\u5883\u53D8\u91CF\u515C\u5E95\uFF09");
}
async function callOpenAICompatible(endpoint, prompt, opts, signal) {
  const { baseURL, apiKey, model } = parseOpenAICompat(endpoint);
  if (!baseURL) throw new SubagentUnavailableError("\u7AEF\u70B9 baseURL \u4E3A\u7A7A");
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const headers = {
    "content-type": "application/json",
    ...apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  };
  const body = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    ...opts.temperature !== void 0 ? { temperature: opts.temperature } : {}
  };
  const lastErr = [];
  try {
    const resp = await fetch(`${baseURL}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (resp.ok) {
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      if (text) return text;
    } else {
      let detail = "";
      try {
        detail = (await resp.text()).slice(0, 300);
      } catch {
      }
      lastErr.push(`chat/completions \u63A5\u53E3\u8FD4\u56DE ${resp.status}: ${detail}`);
    }
  } catch (e) {
    if (e.name === "AbortError") throw e;
    lastErr.push(`chat/completions \u8BF7\u6C42\u5F02\u5E38: ${humanizeFetchError(e)}`);
  }
  const respBody = { model, input: prompt, max_output_tokens: opts.maxTokens ?? 4096 };
  for (const p of ["/v1/responses", "/responses"]) {
    try {
      const resp = await fetch(`${baseURL}${p}`, { method: "POST", headers, body: JSON.stringify(respBody), signal });
      if (resp.ok) {
        const data = await resp.json();
        const text = (data.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text" || c.type === "text").map((c) => c.text ?? "").join("\n");
        if (text) return text;
      } else {
        let detail = "";
        try {
          detail = (await resp.text()).slice(0, 300);
        } catch {
        }
        lastErr.push(`responses \u63A5\u53E3\u8FD4\u56DE ${resp.status}\uFF08\u8DEF\u5F84 ${p}\uFF09: ${detail}`);
      }
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastErr.push(`responses \u8BF7\u6C42\u5F02\u5E38\uFF08\u8DEF\u5F84 ${p}\uFF09: ${humanizeFetchError(e)}`);
    }
  }
  throw new SubagentUnavailableError(`LLM \u8C03\u7528\u5931\u8D25: ${lastErr.join(" | ") || "\u6CA1\u6709\u4EFB\u4F55\u7AEF\u70B9\u54CD\u5E94"}`);
}
async function callViaHostLlm(endpoint, opts, onDelta) {
  const llm = hostLlm();
  if (!llm || typeof llm.stream !== "function") {
    throw new SubagentUnavailableError("host llm \u670D\u52A1\u4E0D\u53EF\u7528\uFF08\u672A\u6CE8\u5165\u6216\u65E0 stream \u65B9\u6CD5\uFF09");
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parts = [];
  const seen = [];
  try {
    const stream = llm.stream({
      provider: endpoint.hostProvider,
      model: endpoint.model,
      ...opts.system ? { system: opts.system } : {},
      // ★ content 必须是**内容块数组**（dsh-llm 的 RequestUserInput.content = readonly ContentBlock[]，
      //   TextBlock = {type:'text',text}）。2026-10-03 前这里传的是字符串 → 宿主适配器校验失败 →
      //   finish{kind:'error',failure} → 被旧代码当正常结束 → 空输出。这是「AI 节点成功但正文为空」的真根因。
      messages: [{ role: "user", content: [{ type: "text", text: opts.prompt }] }],
      ...opts.maxTokens ? { maxTokens: opts.maxTokens } : {},
      ...opts.temperature !== void 0 ? { temperature: opts.temperature } : {},
      signal: ac.signal
    });
    for await (const chunk of stream) {
      if (chunk?.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
        parts.push(chunk.text);
        onDelta?.(chunk.text);
      } else if (chunk?.type === "finish") {
        const finish2 = chunk;
        const reason = finish2.reason;
        const kind = typeof reason === "string" ? reason : reason && typeof reason === "object" ? String(reason.kind ?? "") : "";
        const failure = reason && typeof reason === "object" ? reason.failure : void 0;
        if (kind === "error" || kind === "aborted") {
          const bits = [
            failure?.code,
            failure?.message ?? finish2.error?.message,
            failure?.status != null ? `HTTP ${failure.status}` : ""
          ].filter(Boolean);
          const detail = bits.length ? bits.join(" / ") : typeof reason === "string" ? "\uFF08host \u6CA1\u6709\u63D0\u4F9B\u9519\u8BEF\u8BE6\u60C5\uFF09" : JSON.stringify(reason);
          throw new SubagentUnavailableError(`host llm.stream ${kind === "aborted" ? "\u88AB\u4E2D\u6B62" : "\u5931\u8D25"}: ${detail}`);
        }
        seen.push(`finish:${typeof reason === "string" ? reason : JSON.stringify(reason)}`);
      } else if (chunk?.type) {
        seen.push(String(chunk.type));
      }
    }
  } catch (e) {
    if (e.name === "AbortError") {
      throw new SubagentUnavailableError(`AI \u8282\u70B9\u8D85\u65F6\uFF08${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms\uFF09`);
    }
    if (e instanceof SubagentUnavailableError) throw e;
    throw new SubagentUnavailableError(`host llm.stream \u8C03\u7528\u5931\u8D25: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = parts.join("");
  if (!text.trim()) {
    const detail = seen.length ? seen.join(",") : "\uFF08host \u4E00\u4E2A chunk \u90FD\u6CA1\u4EA7\u51FA\uFF09";
    console.warn(`[dag-flow] host llm.stream \u7A7A\u6D41\uFF1Aprovider=${endpoint.hostProvider ?? "?"} model=${endpoint.model} chunks=[${detail}]`);
    throw new SubagentUnavailableError(`host llm.stream \u672A\u8FD4\u56DE\u4EFB\u4F55\u6587\u672C\uFF08provider=${endpoint.hostProvider ?? "?"} model=${endpoint.model}\uFF1B\u6536\u5230\u7684 chunk\uFF1A${detail}\uFF09\u2014\u2014\u8BF7\u786E\u8BA4\u8BE5\u6A21\u578B\u5728 dsh \u91CC\u53EF\u7528\uFF0C\u6216\u5728\u8282\u70B9\u300C\u9009\u62E9\u6A21\u578B\u300D\u91CC\u6362\u4E00\u4E2A`, "SUBAGENT_EMPTY_OUTPUT");
  }
  return text;
}
async function callSubagent(opts) {
  const hostLlm2 = hostLlm();
  const hostChat = hostLlm2?.chat;
  if (typeof hostChat === "function") {
    try {
      const raw = await hostChat.call(hostLlm2, {
        prompt: opts.prompt,
        ...opts.system ? { system: opts.system } : {},
        ...opts.model ? { model: opts.model } : {}
      });
      const text = typeof raw === "string" ? raw : raw?.text ?? "";
      return { text };
    } catch (e) {
      throw new SubagentUnavailableError(`host llm.chat \u8C03\u7528\u51FA\u9519: ${e.message}`);
    }
  }
  const endpoint = await resolveLlmEndpoint(opts.model);
  if (endpoint.viaHost) {
    const text = await callViaHostLlm(endpoint, opts);
    return { text };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const text = await callOpenAICompatible(endpoint, opts.prompt, opts, ac.signal);
    return { text };
  } catch (e) {
    if (e.name === "AbortError") {
      throw new SubagentUnavailableError(`AI \u8282\u70B9\u8D85\u65F6\uFF08${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms\uFF09`);
    }
    if (e instanceof SubagentUnavailableError) throw e;
    throw new SubagentUnavailableError(`AI \u8282\u70B9\u8C03\u7528\u5931\u8D25: ${e.message}`);
  } finally {
    clearTimeout(t);
  }
}
async function runSubagentNode(params) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const t0 = Date.now();
  try {
    const endpoint = await resolveLlmEndpoint(params.model);
    const modalityHint = checkModelModality(endpoint, params.prompt ?? "");
    if (modalityHint) {
      return {
        status: "failed",
        error: { code: "MODEL_MODALITY_MISMATCH", message: modalityHint },
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const r = await callSubagent(params);
    if (!String(r.text ?? "").trim()) {
      return {
        status: "failed",
        error: { code: "SUBAGENT_EMPTY_OUTPUT", message: "AI \u8282\u70B9\u8FD4\u56DE\u7A7A\u5185\u5BB9\uFF08\u6A21\u578B\u6CA1\u6709\u8F93\u51FA\uFF09\u2014\u2014\u5DF2\u4E0D\u518D\u6309\u6210\u529F\u5904\u7406\uFF1B\u8BF7\u6362\u4E00\u4E2A\u53EF\u7528\u6A21\u578B\uFF0C\u6216\u68C0\u67E5 prompt/\u4E0A\u6E38\u6570\u636E\u662F\u5426\u4E3A\u7A7A" },
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    return {
      status: "success",
      out: r.text,
      durationMs: Date.now() - t0,
      startedAt,
      endedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (e) {
    return {
      status: "failed",
      // 带 code 的用带过来的（如空输出的 SUBAGENT_EMPTY_OUTPUT），其余归 SUBAGENT_UNAVAILABLE
      error: { code: e.code ?? "SUBAGENT_UNAVAILABLE", message: e.message },
      durationMs: Date.now() - t0,
      startedAt,
      endedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}

// src/adapter/runtime.ts
init_dsh_home();
import { existsSync, readdirSync } from "node:fs";
import * as path3 from "node:path";
import { fileURLToPath } from "node:url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
var PLUGIN_ROOT_CANDIDATES = ["..", "../.."].map((rel) => path3.resolve(__dirname, rel));
var USER_RUNTIME_DIR = path3.join(dshHome(), "runtime");
function detectPlatform() {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32" && a === "x64") return "win-x64";
  if (p === "darwin" && a === "x64") return "mac-x64";
  if (p === "darwin" && a === "arm64") return "mac-arm64";
  if (p === "linux" && a === "x64") {
    try {
      if (existsSync("/etc/alpine-release")) return "linux-musl-x64";
    } catch {
    }
    return "linux-x64";
  }
  if (p === "linux" && a === "arm64") return "linux-arm64";
  return "unknown";
}
var PYTHON_VERSION = "3.12.14";
var PYTHON_RELEASE = "20260901";
var BASH_VERSION = "2.55.0.5";
var PY_EXE_BY_PLATFORM = {
  "win-x64": "python.exe",
  "mac-x64": "bin/python3.12",
  "mac-arm64": "bin/python3.12",
  "linux-x64": "bin/python3.12",
  "linux-arm64": "bin/python3.12",
  "linux-musl-x64": "bin/python3.12",
  "unknown": ""
};
var BASH_EXE_BY_PLATFORM = {
  // MinGit 2.55.0.5 完整版解压布局：usr/bin/sh.exe（不是 mingit64/usr/bin/bash.exe）
  "win-x64": "usr/bin/sh.exe",
  "mac-x64": "",
  // 用系统
  "mac-arm64": "",
  "linux-x64": "",
  "linux-arm64": "",
  "linux-musl-x64": "",
  "unknown": ""
};
var BASH_CANDIDATES_WIN = [
  "usr/bin/sh.exe",
  "usr/bin/bash.exe",
  "mingit64/usr/bin/bash.exe",
  "mingit64/usr/bin/sh.exe"
];
function bundledPath(tool, version, platform, sub) {
  for (const root of PLUGIN_ROOT_CANDIDATES) {
    const p = path3.join(root, "runtime", tool, version, platform, sub);
    if (existsSync(p)) return p;
  }
  return path3.join(PLUGIN_ROOT_CANDIDATES[0], "runtime", tool, version, platform, sub);
}
function which(bin) {
  const PATH = (process.env.PATH ?? "").split(path3.delimiter);
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.BAT;.CMD").split(";") : [""];
  for (const p of PATH) {
    for (const ext of exts) {
      const full = path3.join(p, bin + ext);
      try {
        if (existsSync(full)) return full;
      } catch {
      }
    }
  }
  return null;
}
function findCachedExe(tool, platform, sub) {
  const toolRoot = path3.join(USER_RUNTIME_DIR, tool);
  try {
    const versions = readdirSync(toolRoot);
    for (const v of versions) {
      const p = path3.join(toolRoot, v, platform, sub);
      if (existsSync(p)) return p;
    }
  } catch {
  }
  return null;
}
function resolvePython(platform = detectPlatform()) {
  const sub = PY_EXE_BY_PLATFORM[platform];
  if (sub) {
    const bundled = bundledPath("python", `${PYTHON_VERSION}+${PYTHON_RELEASE}`, platform, sub);
    if (existsSync(bundled)) return { exe: bundled, source: "bundled" };
    const cached = findCachedExe("python", platform, sub);
    if (cached) return { exe: cached, source: "user-cache" };
  }
  for (const bin of ["python3.12", "python3", "python", "py"]) {
    const sys = which(bin);
    if (sys) return { exe: sys, source: "system" };
  }
  return { exe: "", source: "missing" };
}
function resolveBash(platform = detectPlatform()) {
  if (platform === "win-x64") {
    for (const cand of BASH_CANDIDATES_WIN) {
      const bundled = bundledPath("bash", BASH_VERSION, platform, cand);
      if (existsSync(bundled)) return { exe: bundled, source: "bundled" };
      const cached = findCachedExe("bash", platform, cand);
      if (cached) return { exe: cached, source: "user-cache" };
    }
  } else {
    const sub = BASH_EXE_BY_PLATFORM[platform];
    if (sub) {
      const bundled = bundledPath("bash", BASH_VERSION, platform, sub);
      if (existsSync(bundled)) return { exe: bundled, source: "bundled" };
      const cached = findCachedExe("bash", platform, sub);
      if (cached) return { exe: cached, source: "user-cache" };
    }
  }
  for (const bin of ["bash"]) {
    const sys = which(bin);
    if (sys) return { exe: sys, source: "system" };
  }
  return { exe: "", source: "missing" };
}

// src/adapter/sessions.ts
import { promises as fs3 } from "node:fs";
import * as path4 from "node:path";
import { readdirSync as readdirSync3, existsSync as existsSync2 } from "node:fs";

// src/dsh-gate/session-format.ts
import { readdirSync as readdirSync2 } from "node:fs";
init_paths();
var SESSION_FILE_CANDIDATES = ["session.v4.jsonl.zstd", "session.v3.jsonl.zstd", "session.jsonl.zstd"];
function hasZstdMagic(buf) {
  return buf.length >= 4 && buf[0] === 40 && buf[1] === 181 && buf[2] === 47 && buf[3] === 253;
}
function decompressZstdAllFrames(buf, decompressSync) {
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 40 && buf[i + 1] === 181 && buf[i + 2] === 47 && buf[i + 3] === 253) offsets.push(i);
  }
  if (offsets.length === 0) return null;
  if (offsets.length === 1 && offsets[0] === 0) {
    return decompressSync(buf).toString("utf8");
  }
  const parts = [];
  for (let k = 0; k < offsets.length; k++) {
    const start = offsets[k];
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
    try {
      parts.push(decompressSync(buf.subarray(start, end)).toString("utf8"));
    } catch {
    }
  }
  return parts.join("\n");
}
function escapeDirNameLegacy(s) {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9-]/.test(ch)) out += ch;
    else out += "~" + ch.charCodeAt(0).toString(16).toUpperCase();
  }
  return out;
}
function escapeDirNameV3(s) {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9-]/.test(ch)) out += ch;
    else if (ch === ":" || ch === "\\" || ch === "/") out += "-";
    else out += "~" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}
function scanWorkspaceDirs(workspace) {
  const root = sessionsRoot();
  let all = [];
  try {
    all = readdirSync2(root).filter((d) => d.startsWith("--") && d.endsWith("--"));
  } catch {
    return [];
  }
  if (!workspace) return all;
  const preferred = /* @__PURE__ */ new Set([
    `--${workspace}--`,
    `--${escapeDirNameLegacy(workspace)}--`,
    `--${escapeDirNameV3(workspace)}--`
  ]);
  const hit = all.filter((d) => preferred.has(d));
  const rest = all.filter((d) => !preferred.has(d));
  return [...hit, ...rest];
}
function parseMessages(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  const messages = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      let role = "";
      let payload = obj;
      if ((obj.type === "user/message" || obj.type === "assistant/message") && obj.data && typeof obj.data === "object") {
        role = obj.type === "user/message" ? "user" : "assistant";
        payload = obj.data;
      } else {
        role = String(obj.role ?? obj.type ?? "");
        if (role === "session" || role === "user/message" || role === "assistant/message") continue;
      }
      const contentObj = payload?.content;
      let content = "";
      if (typeof contentObj === "string") content = contentObj;
      else if (Array.isArray(contentObj)) {
        content = contentObj.map((c) => c && typeof c.text === "string" ? c.text : "").join("\n");
      }
      if (role && content) messages.push({ role, content });
    } catch {
    }
  }
  return messages;
}

// src/adapter/sessions.ts
init_paths();
var SESSIONS_ROOT = sessionsRoot();
async function readSessionContent(sessionId, limit = 10, workspace) {
  let file = "";
  outer: for (const d of scanWorkspaceDirs(workspace)) {
    for (const f of SESSION_FILE_CANDIDATES) {
      const c = path4.join(SESSIONS_ROOT, d, sessionId, f);
      if (existsSync2(c)) {
        file = c;
        break outer;
      }
    }
  }
  if (!file) return null;
  let buf;
  try {
    buf = await fs3.readFile(file);
  } catch (e) {
    throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u4F1A\u8BDD\u6587\u4EF6: ${e.message}`);
  }
  let text;
  try {
    const { zstdDecompressSync } = await import("node:zlib");
    if (typeof zstdDecompressSync !== "function") {
      throw new Error("\u9700\u8981 Node >= 22.13 \u624D\u652F\u6301 zstd \u89E3\u538B");
    }
    const multi = decompressZstdAllFrames(buf, zstdDecompressSync);
    if (multi === null) {
      text = buf.toString("utf8");
    } else {
      text = multi;
    }
  } catch (e) {
    if (hasZstdMagic(buf)) throw new Error(`zstd \u89E3\u538B\u5931\u8D25: ${e.message}`);
    text = buf.toString("utf8");
  }
  const recent = parseMessages(text).slice(-Math.max(1, limit));
  if (recent.length === 0) return "";
  return recent.map((m) => `\u3010${m.role}\u3011
${m.content}`).join("\n\n");
}
var TITLE_HEAD_BYTES = 256 * 1024;
var TITLE_TAIL_BYTES = 64 * 1024;

// src/adapter/assets.ts
init_workspace();
import { promises as fs5 } from "node:fs";
import { createWriteStream, existsSync as existsSync3 } from "node:fs";
import * as path6 from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
async function outputDir() {
  return dagFlowDir();
}
function safeOutputPath(dir, filename) {
  const base = path6.basename(filename).replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-").replace(/^[-.]+/, "") || `output-${Date.now()}`;
  const dirPartRaw = path6.dirname(filename).replace(/\\/g, "/");
  let sub = "";
  if (dirPartRaw && dirPartRaw !== "." && dirPartRaw !== "/") {
    const cleaned = dirPartRaw.replace(/[^\w\-\u4e00-\u9fa5/]+/g, "-").replace(/^\/+|\/+$/g, "");
    if (cleaned && !cleaned.includes("..")) sub = cleaned;
  }
  const full = sub ? path6.join(dir, sub, base) : path6.join(dir, base);
  const resolved = path6.resolve(full);
  if (!resolved.startsWith(path6.resolve(dir))) {
    throw new Error(`\u6587\u4EF6\u540D\u975E\u6CD5\uFF08\u8DEF\u5F84\u8D8A\u754C\uFF09: ${filename}`);
  }
  return resolved;
}
function uniqueOutputPath(file) {
  if (!existsSync3(file)) return file;
  const dir = path6.dirname(file);
  const ext = path6.extname(file);
  const stem = path6.basename(file, ext);
  for (let i = 2; i < 1e3; i++) {
    const cand = path6.join(dir, `${stem}-${i}${ext}`);
    if (!existsSync3(cand)) return cand;
  }
  return path6.join(dir, `${stem}-${Date.now()}${ext}`);
}
async function saveAsset(filename, content, encoding) {
  const dir = await outputDir();
  const file = uniqueOutputPath(safeOutputPath(dir, filename));
  await fs5.mkdir(path6.dirname(file), { recursive: true });
  const buf = typeof content === "string" ? encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8") : Buffer.from(content);
  await fs5.writeFile(file, buf);
  const root = await workspaceRoot();
  return {
    relativePath: path6.relative(root, file).replace(/\\/g, "/"),
    absolutePath: file,
    bytes: buf.length
  };
}
async function downloadAsset(url, filename, timeoutMs = 3e5) {
  const dir = await outputDir();
  const file = uniqueOutputPath(safeOutputPath(dir, filename));
  await fs5.mkdir(path6.dirname(file), { recursive: true });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let tmpFile = null;
  try {
    const resp = await fetch(url, { signal: ac.signal });
    if (!resp.ok) throw new Error(`\u4E0B\u8F7D\u5931\u8D25\uFF08HTTP ${resp.status}\uFF09: ${url.slice(0, 120)}`);
    if (!resp.body) throw new Error(`\u4E0B\u8F7D\u5931\u8D25\uFF1A\u54CD\u5E94\u65E0\u5185\u5BB9: ${url.slice(0, 120)}`);
    const tmpDir = await dagFlowTmpDir();
    tmpFile = path6.join(tmpDir, `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.part`);
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(tmpFile));
    await fs5.rename(tmpFile, file);
    tmpFile = null;
    const stat = await fs5.stat(file);
    const root = await workspaceRoot();
    return {
      relativePath: path6.relative(root, file).replace(/\\/g, "/"),
      absolutePath: file,
      bytes: stat.size
    };
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`\u4E0B\u8F7D\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09: ${url.slice(0, 120)}`);
    throw e;
  } finally {
    clearTimeout(t);
    if (tmpFile) {
      await fs5.rm(tmpFile, { force: true }).catch(() => {
      });
    }
  }
}

// src/adapter/search.ts
init_safety();
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var ACCEPT_LANG = "zh-CN,zh;q=0.9,en;q=0.8";
var LANG_PROFILES = {
  zh: { market: "zh-CN", acceptLang: "zh-CN,zh;q=0.9,en;q=0.8" },
  en: { market: "en-US", acceptLang: "en-US,en;q=0.9" },
  ru: { market: "ru-RU", acceptLang: "ru-RU,ru;q=0.9,en;q=0.8" },
  ja: { market: "ja-JP", acceptLang: "ja-JP,ja;q=0.9,en;q=0.8" },
  de: { market: "de-DE", acceptLang: "de-DE,de;q=0.9,en;q=0.8" },
  fr: { market: "fr-FR", acceptLang: "fr-FR,fr;q=0.9,en;q=0.8" },
  es: { market: "es-ES", acceptLang: "es-ES,es;q=0.9,en;q=0.8" },
  ko: { market: "ko-KR", acceptLang: "ko-KR,ko;q=0.9,en;q=0.8" }
};
var DAYS_BY_RANGE = { day: 1, week: 7, month: 30, year: 365 };
var SEARXNG_TIME = { day: "day", week: "week", month: "month", year: "year" };
var SEARXNG_INSTANCES = [
  "https://opnxng.com",
  "https://priv.au",
  "https://searx.be",
  "https://searx.tiekoetter.com",
  "https://search.inetol.net",
  "https://paulgo.io"
];
function decodeEntities(text) {
  return String(text).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function extractDdgUrl(rel) {
  if (!rel) return null;
  const m = rel.match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  if (rel.startsWith("//")) return `https:${rel}`;
  return rel;
}
function uniqueSources(sources, limit) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push(s);
    }
    if (out.length >= limit) break;
  }
  return out;
}
var SNIPPET_NOISE = /\b(sign up|sign in|log in|login|subscribe( to| for)?|member[- ]?only|become a member|create (a )?free account|read more|continue reading|story continues|get started|install (the )?app|view on|medium membership|join \w+ for free|get updates from this writer|stories in your inbox|remember me for|unlock this|free to read|become a patron)\b/gi;
function cleanSnippet(text) {
  if (!text) return void 0;
  return String(text).replace(SNIPPET_NOISE, " ").replace(/^\s*(#{1,6}\s*|\[\s*x?\s*\]\s*|-\s*\[\s*x?\s*\]\s*|>\s*)/gm, " ").replace(/\s+/g, " ").trim().slice(0, 300) || void 0;
}
async function fetchHtml(url, signal, acceptLang) {
  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12e3);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, "accept-language": acceptLang ?? ACCEPT_LANG },
        signal: controller.signal,
        redirect: "follow"
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`\u8FDE\u63A5\u5931\u8D25: ${error?.message ?? String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}\uFF08${url.split("?")[0]}\uFF09`);
  }
  const html = await response.text();
  if (response.status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(html.slice(0, 4e3))) {
    throw new Error("DuckDuckGo \u89E6\u53D1\u53CD\u722C\u9A8C\u8BC1\uFF08\u901A\u5E38\u662F\u4E34\u65F6\u9650\u6D41\uFF0C\u7A0D\u540E\u6062\u590D\uFF09");
  }
  return html;
}
async function fetchHtmlWithRetry(url, signal, acceptLang) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchHtml(url, signal, acceptLang);
      if (html.length > 500) return html;
      lastError = new Error(`\u7A7A\u54CD\u5E94\uFF08${html.length} \u5B57\u8282\uFF09`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve4) => setTimeout(resolve4, 1500));
  }
  throw lastError ?? new Error("\u6293\u53D6\u5931\u8D25");
}
function queryOverlapTokens(query) {
  const tokens = /* @__PURE__ */ new Set();
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length <= 2) tokens.add(run);
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  for (const word of String(query).toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 2) tokens.add(word);
  }
  return [...tokens];
}
function looksRelevant(query, sources) {
  const tokens = queryOverlapTokens(query);
  if (tokens.length === 0) return true;
  return sources.some((s) => {
    const hay = `${s.title ?? ""} ${s.snippet ?? ""} ${s.url ?? ""}`.toLowerCase();
    return tokens.some((t) => hay.includes(t.toLowerCase()));
  });
}
async function searchBing(query, count, options, signal) {
  const profile = LANG_PROFILES[options.lang ?? ""] ?? LANG_PROFILES.zh;
  const params = new URLSearchParams({ q: query, mkt: profile.market });
  const html = await fetchHtmlWithRetry(`https://www.bing.com/search?${params}`, signal, profile.acceptLang);
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  const sources = [];
  for (const block of blocks) {
    const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!hrefMatch) continue;
    sources.push({
      url: hrefMatch[1],
      ...titleMatch ? { title: stripTags(titleMatch[1]) } : {},
      ...snippetMatch ? { snippet: cleanSnippet(snippetMatch[1]) } : {}
    });
  }
  if (sources.length > 0 && !looksRelevant(query, sources)) return [];
  return uniqueSources(sources, count);
}
async function searchDdgLite(query, count, options, signal) {
  const params = new URLSearchParams({ q: query });
  if (options.timeRange && DAYS_BY_RANGE[options.timeRange]) {
    const days = DAYS_BY_RANGE[options.timeRange];
    const df = days <= 2 ? "d" : days <= 14 ? "w" : days <= 90 ? "m" : "y";
    params.set("df", df);
  }
  const html = await fetchHtmlWithRetry(`https://lite.duckduckgo.com/lite/?${params}`, signal);
  const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
  const sources = [];
  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i];
    const hrefMatch = tag.match(/href="([^"]*)"/);
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
    if (!hrefMatch) continue;
    const url = extractDdgUrl(hrefMatch[1]);
    if (!url) continue;
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
    sources.push({
      url,
      ...titleMatch ? { title: stripTags(titleMatch[1]) } : {},
      ...snippet ? { snippet: cleanSnippet(snippet) } : {}
    });
  }
  return uniqueSources(sources, count);
}
async function searchDdgHtml(query, count, options, signal) {
  const params = new URLSearchParams({ q: query });
  if (options.timeRange && DAYS_BY_RANGE[options.timeRange]) {
    const days = DAYS_BY_RANGE[options.timeRange];
    const df = days <= 2 ? "d" : days <= 14 ? "w" : days <= 90 ? "m" : "y";
    params.set("df", df);
  }
  const html = await fetchHtmlWithRetry(`https://html.duckduckgo.com/html/?${params}`, signal);
  const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? [];
  const sources = [];
  for (const block of blocks) {
    const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/);
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
    const dateMatch = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/);
    const url = extractDdgUrl(urlMatch?.[1]);
    if (!url) continue;
    sources.push({
      url,
      ...titleMatch ? { title: stripTags(titleMatch[1]) } : {},
      ...snippetMatch ? { snippet: cleanSnippet(snippetMatch[1]) } : {},
      ...dateMatch ? { publishedAt: dateMatch[1] } : {}
    });
  }
  return uniqueSources(sources, count);
}
async function searchSearxng(query, count, options, signal) {
  const instances = options.searxngInstances?.length ? options.searxngInstances : SEARXNG_INSTANCES;
  const errors = [];
  for (const base of instances) {
    try {
      const params = new URLSearchParams({ q: query, format: "json" });
      if (options.timeRange && SEARXNG_TIME[options.timeRange]) params.set("time_range", SEARXNG_TIME[options.timeRange]);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8e3);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort);
      let response;
      try {
        response = await fetch(`${base}/search?${params}`, {
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
          signal: ctrl.signal
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (!response.ok) {
        errors.push(`${base}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json().catch(() => null);
      if (!data || !Array.isArray(data.results)) {
        errors.push(`${base}: \u8FD4\u56DE\u4E86\u975E JSON \u5185\u5BB9`);
        continue;
      }
      const sources = data.results.filter((r) => r.url).map((r) => ({
        url: r.url,
        ...r.title ? { title: String(r.title) } : {},
        ...r.content ? { snippet: cleanSnippet(r.content) } : {}
      }));
      if (sources.length > 0) return uniqueSources(sources, count);
      errors.push(`${base}: 0 \u6761\u7ED3\u679C`);
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${base}: ${error.message}`);
    }
  }
  const detail = errors.length > 0 ? errors.join(", ") : "no instances configured";
  throw new Error(`\u6240\u6709 SearXNG \u5B9E\u4F8B\u5747\u5931\u8D25: ${detail.slice(0, 300)}`);
}
async function searchAnysearch(query, count, _options, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12e3);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  let response;
  try {
    response = await fetch("https://api.anysearch.com/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, max_results: count }),
      signal: controller.signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`AnySearch \u8BF7\u6C42\u5931\u8D25: ${error?.message ?? String(error)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  if (!response.ok) throw new Error(`AnySearch API \u9519\u8BEF\uFF08HTTP ${response.status}\uFF09`);
  const data = await response.json();
  if (data.code !== 0) throw new Error(`AnySearch API \u9519\u8BEF: ${data.message ?? data.code}`);
  const results = data.data?.results ?? [];
  return results.filter((r) => r.url).map((r) => ({
    url: r.url,
    ...r.title ? { title: String(r.title) } : {},
    ...r.snippet ? { snippet: cleanSnippet(r.snippet) } : {}
  }));
}
var ENGINE_RUNNERS = {
  bing: searchBing,
  "ddg-lite": searchDdgLite,
  ddg: searchDdgHtml,
  searxng: searchSearxng,
  anysearch: searchAnysearch
};
var ENGINE_CHAIN = ["bing", "ddg-lite", "ddg", "searxng", "anysearch"];
function getHostTools() {
  try {
    const tools = hostService("tools");
    return tools && typeof tools.execute === "function" ? tools : null;
  } catch {
    return null;
  }
}
function normalizeHostOutput(raw, limit) {
  let cur = raw;
  if (typeof cur === "string") {
    try {
      cur = JSON.parse(cur);
    } catch {
      return null;
    }
  }
  if (cur == null || typeof cur !== "object") return null;
  const obj = cur;
  if (Array.isArray(obj.content)) {
    for (const block of obj.content) {
      if (block?.type !== "text") continue;
      try {
        const j = JSON.parse(String(block.text ?? ""));
        const arr2 = j?.sources ?? j?.results;
        if (Array.isArray(arr2)) return toSources(arr2, limit);
      } catch {
      }
    }
  }
  const arr = obj.sources ?? obj.results;
  if (Array.isArray(arr)) return toSources(arr, limit);
  return null;
}
function toSources(arr, limit) {
  return arr.filter((it) => it && typeof it === "object" && typeof it.url === "string").slice(0, limit).map((it) => {
    const o = it;
    return {
      url: o.url,
      ...o.title != null ? { title: String(o.title) } : {},
      ...o.snippet != null ? { snippet: cleanSnippet(o.snippet) } : o.content != null ? { snippet: cleanSnippet(o.content) } : {},
      ...o.publishedAt != null ? { publishedAt: String(o.publishedAt) } : {}
    };
  });
}
async function tryHostSearch(p, signal) {
  const tools = getHostTools();
  const execute = tools?.execute;
  if (typeof execute !== "function") return null;
  try {
    const get = tools?.get;
    if (typeof get === "function" && !get("web_search")) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25e3);
    const onAbort = () => ac.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const callId = `dag-flow-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const raw = await execute({
        callId,
        name: "web_search",
        arguments: { query: p.query, count: p.count, ...p.timeRange ? { timeRange: p.timeRange } : {} },
        signal: ac.signal
      });
      const results = normalizeHostOutput(raw, p.count);
      if (results && results.length > 0) return { results, engine: "host:web_search", viaHost: true };
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  } catch {
    return null;
  }
}
async function runWebSearch(p, signal) {
  const provider = p.provider && p.provider !== "auto" ? p.provider : "auto";
  const count = Math.max(1, Math.min(20, Math.floor(p.count) || 8));
  if (signal?.aborted) throw new Error("\u8FD0\u884C\u5DF2\u88AB\u53D6\u6D88");
  if (provider === "auto" || provider === "host") {
    const host = await tryHostSearch(p, signal);
    if (host) return host;
    if (provider === "host") {
      throw new Error("\u5BBF\u4E3B web_search \u5DE5\u5177\u4E0D\u53EF\u7528\uFF08\u672A\u5B89\u88C5 dsh-free-search \u63D2\u4EF6\u6216\u8C03\u7528\u5931\u8D25\uFF09\u2014\u2014\u6539\u7528 provider=auto \u6216\u6307\u5B9A\u5185\u7F6E\u5F15\u64CE");
    }
  }
  const chain = provider === "auto" ? ENGINE_CHAIN : [provider];
  const errors = [];
  for (const eng of chain) {
    const runner = ENGINE_RUNNERS[eng];
    if (!runner) {
      errors.push(`${eng}: unknown engine`);
      continue;
    }
    try {
      if (signal?.aborted) throw new Error("\u8FD0\u884C\u5DF2\u88AB\u53D6\u6D88");
      const sources = await runner(p.query, count, p, signal);
      if (sources.length > 0) {
        return { results: sources.slice(0, count), engine: eng, viaHost: false };
      }
      errors.push(`${eng}: 0 \u6761\u7ED3\u679C`);
    } catch (error) {
      if (signal?.aborted) throw new Error("\u8FD0\u884C\u5DF2\u88AB\u53D6\u6D88");
      errors.push(`${eng}: ${error.message}`);
    }
  }
  throw new Error(`\u6240\u6709\u641C\u7D22\u5F15\u64CE\u5747\u5931\u8D25\uFF1A${errors.join("\uFF1B").slice(0, 400)}`);
}
function htmlToText(html) {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}
async function runWebFetch(p, signal) {
  const timeoutMs = Math.max(1e3, Math.min(3e5, p.timeoutMs ?? 3e4));
  const maxChars = Math.max(200, Math.min(2e5, Math.floor(p.maxChars ?? 8e3)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(p.url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-language": ACCEPT_LANG },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}\uFF08${p.url.split("?")[0]}\uFF09`);
    }
    const contentType = String(response.headers.get("content-type") ?? "");
    const body = await response.text();
    if (p.raw) {
      return { url: p.url, status: response.status, contentType, mode: "raw", text: body.slice(0, maxChars), chars: Math.min(body.length, maxChars) };
    }
    if (/\bjson\b/i.test(contentType)) {
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        const text2 = body.slice(0, maxChars);
        return { url: p.url, status: response.status, contentType, mode: "text", text: text2, chars: text2.length };
      }
      return { url: p.url, status: response.status, contentType, mode: "json", json, chars: body.length };
    }
    const text = htmlToText(body).slice(0, maxChars);
    return { url: p.url, status: response.status, contentType, mode: "text", text, chars: text.length };
  } catch (error) {
    if (error.name === "AbortError" || signal?.aborted) {
      if (signal?.aborted) throw new Error("\u8FD0\u884C\u5DF2\u88AB\u53D6\u6D88");
      const timeoutErr = new Error(`\u7F51\u9875\u6293\u53D6\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09\u2014\u2014\u589E\u5927 timeoutMs \u6216\u7A0D\u540E\u91CD\u8BD5`);
      timeoutErr.name = "FetchTimeout";
      throw timeoutErr;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// src/registry/builtin.ts
init_awaiting();
init_dataflow();
function startedEnded() {
  return { startedAt: (/* @__PURE__ */ new Date()).toISOString(), t0: Date.now() };
}
function scriptEnv(exe) {
  const env = { ...process.env };
  const sep = process.platform === "win32" ? ";" : ":";
  env.PATH = `${dirname5(exe)}${sep}${env.PATH ?? ""}`;
  if (!env.HOME) env.HOME = env.USERPROFILE ?? env.HOMEPATH ?? "";
  return env;
}
async function resolveCodePath(p) {
  if (isAbsolute2(p)) return p;
  const { dagFlowDir: dagFlowDir2 } = await Promise.resolve().then(() => (init_workspace(), workspace_exports));
  return join8(await dagFlowDir2(), p);
}
function finish(t0, startedAt, r) {
  return { ...makeResult("success", r), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
var startDef = {
  type: "start",
  schema: { type: "object", additionalProperties: false, properties: {} },
  run: async (_ctx, params) => {
    const { startedAt, t0 } = startedEnded();
    return finish(t0, startedAt, { out: params ?? null });
  },
  describe: () => ({ label: "\u5F00\u59CB", category: "control" })
};
var endDef = {
  type: "end",
  schema: { type: "object", additionalProperties: false, properties: { outputs: { type: "object" } } },
  run: async (ctx, params) => {
    const { startedAt, t0 } = startedEnded();
    const outputs = params?.["outputs"] ?? {};
    return finish(t0, startedAt, { out: { ...ctx.vars, ...outputs } });
  },
  describe: () => ({ label: "\u7ED3\u675F", category: "control" })
};
async function runPython(p) {
  const { startedAt, t0 } = startedEnded();
  const code = p.codePath ? await readFile(await resolveCodePath(p.codePath), "utf8") : p.code ?? "";
  if (!code) return { ...makeResult("failed", { error: { code: "PYTHON_NO_CODE", message: "code/codePath \u4E3A\u7A7A\u2014\u2014\u586B\u5199\u8981\u6267\u884C\u7684 Python \u4EE3\u7801" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  const { exe, source } = resolvePython();
  if (!exe) {
    return { ...makeResult("failed", { error: { code: "PYTHON_UNAVAILABLE", message: `Python \u8FD0\u884C\u65F6\u672A\u627E\u5230\u3002\u6267\u884C\uFF1Anode scripts/download-runtime.mjs --platform=${detectPlatform()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const timeoutMs = p.timeoutMs ?? 3e4;
  return new Promise((resolve4) => {
    let settled = false;
    const settle = (r) => {
      if (!settled) {
        settled = true;
        resolve4(r);
      }
    };
    let child;
    try {
      child = spawn(exe, ["-c", code], {
        cwd: p.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // ★ 强制 Python 以 UTF-8 写 stdout/stderr——中文 Windows 下管道默认用系统代码页（GBK），
        //   Node 按 UTF-8 解码会得到乱码（2026-10-02 用户实测「你好」变乱码）
        env: { ...scriptEnv(exe), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }
      });
    } catch (e) {
      settle({ ...makeResult("failed", { error: { code: "PYTHON_SPAWN", message: `${exe}: ${e.message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
      return;
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ ...makeResult("failed", { error: { code: "PYTHON_TIMEOUT", message: `\u6267\u884C\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      settle({ ...makeResult("failed", { error: { code: "PYTHON_SPAWN", message: e.message } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
    });
    child.on("close", (code2) => {
      clearTimeout(t);
      if (code2 === 0) settle(finish(t0, startedAt, { out: out.replace(/\n$/, "") }));
      else settle({ ...makeResult("failed", { error: { code: "PYTHON_EXIT", message: `\u9000\u51FA\u7801 ${code2}\uFF08\u975E\u96F6\uFF09: ${err.trim() || out.trim()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
    });
  });
}
var pythonDef = {
  type: "python",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: { type: "string" },
      codePath: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1, maximum: 6e5 },
      cwd: { type: "string" },
      requirements: { type: "array", items: { type: "string" } },
      packages: { type: "array", items: { type: "string" } }
    },
    anyOf: [{ required: ["code"] }, { required: ["codePath"] }]
  },
  run: async (_ctx, p) => safeNodeRun(() => runPython(p)),
  describe: () => ({ label: "Python", category: "script" })
};
var DESTRUCTIVE = /(^|\s|;|&&|\|\|)(rm\s+-rf\s+\/|mkfs|dd\s+if=|format\s+)/;
async function runBash(p) {
  const { startedAt, t0 } = startedEnded();
  const code = p.codePath ? await readFile(await resolveCodePath(p.codePath), "utf8") : p.code ?? "";
  if (!code) return { ...makeResult("failed", { error: { code: "BASH_NO_CODE", message: "code/codePath \u4E3A\u7A7A\u2014\u2014\u586B\u5199\u8981\u6267\u884C\u7684 Bash \u811A\u672C" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  if (DESTRUCTIVE.test(code) && !p.dangerouslyAllowDestructive) {
    return { ...makeResult("failed", { error: { code: "BASH_DESTRUCTIVE", message: "\u68C0\u6D4B\u5230\u9AD8\u5371\u547D\u4EE4\u2014\u2014\u5982\u786E\u8BA4\u8981\u6267\u884C\uFF0C\u8BF7\u5728\u8282\u70B9\u53C2\u6570\u4E2D\u8BBE\u7F6E dangerouslyAllowDestructive: true" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const { exe, source } = resolveBash();
  if (!exe) {
    return { ...makeResult("failed", { error: { code: "BASH_UNAVAILABLE", message: `bash \u8FD0\u884C\u65F6\u672A\u627E\u5230\u3002\u6267\u884C\uFF1Anode scripts/download-runtime.mjs --platform=${detectPlatform()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const timeoutMs = p.timeoutMs ?? 3e4;
  return new Promise((resolve4) => {
    let settled = false;
    const settle = (r) => {
      if (!settled) {
        settled = true;
        resolve4(r);
      }
    };
    let child;
    try {
      child = spawn(exe, ["-c", code], { cwd: p.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: scriptEnv(exe) });
    } catch (e) {
      settle({ ...makeResult("failed", { error: { code: "BASH_SPAWN", message: `${exe}: ${e.message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
      return;
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ ...makeResult("failed", { error: { code: "BASH_TIMEOUT", message: `\u6267\u884C\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      const msg = e.code === "ENOENT" ? "bash not found on PATH (Windows: install Git Bash / WSL; macOS/Linux: install bash)" : e.message;
      settle({ ...makeResult("failed", { error: { code: "BASH_SPAWN", message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
    });
    child.on("close", (code2) => {
      clearTimeout(t);
      if (code2 === 0) settle(finish(t0, startedAt, { out: out.replace(/\n$/, "") }));
      else settle({ ...makeResult("failed", { error: { code: "BASH_EXIT", message: `\u9000\u51FA\u7801 ${code2}\uFF08\u975E\u96F6\uFF09: ${err.trim() || out.trim()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() });
    });
  });
}
var bashDef = {
  type: "bash",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: { type: "string" },
      codePath: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1, maximum: 6e5 },
      cwd: { type: "string" },
      dangerouslyAllowDestructive: { type: "boolean" }
    },
    anyOf: [{ required: ["code"] }, { required: ["codePath"] }]
  },
  run: async (_ctx, p) => safeNodeRun(() => runBash(p)),
  describe: () => ({ label: "Bash", category: "script" })
};
var subagentDef = {
  type: "subagent",
  schema: {
    type: "object",
    required: ["prompt", "model"],
    additionalProperties: false,
    properties: {
      prompt: { type: "string", minLength: 1 },
      model: { type: "string", description: "\u5FC5\u586B\uFF1Adsh \u5DF2\u914D\u7F6E\u7684\u6A21\u578B id\uFF08\u5982 dsh:glm-5.3-flash\uFF09\uFF0C\u7F3A\u6A21\u578B\u8282\u70B9\u4E0D\u6267\u884C" },
      isolated: { type: "boolean" },
      agentPreset: { type: "string" },
      system: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1, maximum: 6e5 }
    }
  },
  run: async (_ctx, p) => safeNodeRun(async () => {
    if (!String(p.model ?? "").trim()) {
      const { startedAt, t0 } = startedEnded();
      return { ...makeResult("failed", { error: { code: "MODEL_REQUIRED", message: "\u672A\u9009\u62E9\u6267\u884C\u6A21\u578B\u2014\u2014\u5728\u8282\u70B9\u914D\u7F6E\u7684\u300C\u9009\u62E9\u6A21\u578B\u300D\u4E2D\u9009\u62E9 dsh \u5DF2\u914D\u7F6E\u7684\u6A21\u578B\u540E\u91CD\u8BD5" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    if (!String(p.prompt ?? "").trim()) {
      const { startedAt, t0 } = startedEnded();
      return { ...makeResult("failed", { error: { code: "SUBAGENT_EMPTY_PROMPT", message: "prompt \u4E3A\u7A7A\u2014\u2014AI \u8282\u70B9\u672A\u6267\u884C\uFF0C\u6D41\u7A0B\u5DF2\u5728\u6B64\u4E2D\u65AD\u3002\u68C0\u67E5\u4E0A\u6E38\u8F93\u51FA\u662F\u5426\u4E3A\u7A7A\uFF0C\u6216\u586B\u5165\u63D0\u793A\u8BCD\u540E\u91CD\u8BD5" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    return runSubagentNode(p);
  }),
  describe: () => ({ label: "AI \u5B50\u4EE3\u7406", category: "ai" })
};
async function runSessionInput(p) {
  const { startedAt, t0 } = startedEnded();
  if (!p.sessionId) {
    return { ...makeResult("failed", { error: { code: "SESSION_INPUT_NO_ID", message: "sessionId \u4E3A\u7A7A\u2014\u2014\u8BF7\u9009\u62E9\u8981\u8BFB\u53D6\u7684\u4F1A\u8BDD" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const limit = Math.max(1, Math.min(500, p.limit ?? 10));
  try {
    const content = await readSessionContent(p.sessionId, limit, p.workspace);
    if (content === null) {
      return { ...makeResult("failed", { error: { code: "SESSION_INPUT_NOT_FOUND", message: `\u4F1A\u8BDD\u4E0D\u5B58\u5728: ${p.sessionId}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    return finish(t0, startedAt, { out: content });
  } catch (e) {
    return { ...makeResult("failed", { error: { code: "SESSION_INPUT_READ", message: `\u8BFB\u53D6\u4F1A\u8BDD\u5931\u8D25: ${e.message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
}
var sessionInputDef = {
  type: "session_input",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sessionId: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      workspace: { type: "string" }
    }
  },
  run: async (_ctx, p) => safeNodeRun(() => runSessionInput(p)),
  describe: () => ({ label: "\u4F1A\u8BDD\u8F93\u5165", category: "ai" })
};
async function runHttp(p) {
  const { startedAt, t0 } = startedEnded();
  const timeoutMs = p.timeoutMs ?? 3e4;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(p.url, {
      method: p.method ?? "GET",
      headers: p.headers,
      body: p.body,
      signal: ac.signal
    });
    const text = await r.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
    }
    return finish(t0, startedAt, { out: { status: r.status, body } });
  } catch (e) {
    if (e.name === "AbortError") {
      return { ...makeResult("failed", { error: { code: "HTTP_TIMEOUT", message: `\u8BF7\u6C42\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    return { ...makeResult("failed", { error: { code: "HTTP_ERROR", message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  } finally {
    clearTimeout(t);
  }
}
var httpDef = {
  type: "http",
  schema: {
    type: "object",
    required: ["url"],
    additionalProperties: false,
    properties: {
      method: { enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
      url: { type: "string", minLength: 1 },
      headers: { type: "object", additionalProperties: { type: "string" } },
      body: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1, maximum: 6e5 }
    }
  },
  run: async (_ctx, p) => safeNodeRun(() => runHttp(p)),
  describe: () => ({ label: "HTTP", category: "io" })
};
var setVarDef = {
  type: "set_var",
  schema: {
    type: "object",
    required: ["vars"],
    additionalProperties: false,
    properties: { vars: { type: "object", additionalProperties: true } }
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    Object.assign(ctx.vars, p.vars);
    return finish(t0, startedAt, { out: { ...p.vars } });
  },
  describe: () => ({ label: "\u8BBE\u7F6E\u53D8\u91CF", category: "data" })
};
var ifDef = {
  type: "if",
  schema: { type: "object", required: ["condition"], additionalProperties: false, properties: { condition: { type: "string", minLength: 1 } } },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const v = evaluateBool(p.condition, ctxToScope(ctx));
    return finish(t0, startedAt, { out: v });
  },
  describe: () => ({ label: "\u6761\u4EF6\u5206\u652F", category: "control" })
};
var switchDef = {
  type: "switch",
  schema: {
    type: "object",
    required: ["value", "cases"],
    additionalProperties: false,
    properties: {
      value: { type: "string", minLength: 1 },
      cases: { type: "object", additionalProperties: { type: "string" } }
    }
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    let v;
    try {
      v = evaluateExpr(p.value, ctxToScope(ctx));
    } catch {
      v = void 0;
    }
    const matched = v === void 0 || v === null ? String(p.value ?? "") : String(v);
    const target = p.cases[matched] ?? p.cases["*"] ?? null;
    return finish(t0, startedAt, { out: { matched, target } });
  },
  describe: () => ({ label: "\u591A\u8DEF\u5206\u652F", category: "control" })
};
async function runLoop(p, ctx) {
  const { startedAt, t0 } = startedEnded();
  const maxIter = Math.min(p.maxIterations ?? 1e3, 1e5);
  const iterations = [];
  if (Array.isArray(p.over)) {
    const n = Math.min(p.over.length, maxIter);
    for (let i = 0; i < n; i++) iterations.push(p.over[i]);
  } else if (typeof p.count === "number") {
    const n = Math.max(0, Math.min(Math.floor(p.count), maxIter));
    for (let i = 0; i < n; i++) iterations.push(i);
  } else if (typeof p.while === "string") {
    let i = 0;
    while (i < maxIter) {
      const keepGoing = evaluateBool(p.while, ctxToScope(ctx));
      if (!keepGoing) break;
      iterations.push(i);
      i++;
      if (i >= maxIter && !p.dangerouslyAllowInfinite) {
        return { ...makeResult("failed", { error: { code: "LOOP_MAX_ITER", message: `\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570 ${maxIter}\u2014\u2014\u5982\u786E\u8BA4\u8981\u7EE7\u7EED\uFF0C\u8BBE\u7F6E dangerouslyAllowInfinite: true` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
      }
    }
  } else {
    return { ...makeResult("failed", { error: { code: "LOOP_NO_BOUND", message: "\u7F3A\u5C11\u5FAA\u73AF\u8FB9\u754C\u2014\u2014count / while / over \u81F3\u5C11\u914D\u7F6E\u4E00\u4E2A" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const body = p.body;
  if (!body?.workflowName) return finish(t0, startedAt, { out: { count: iterations.length, items: iterations } });
  const depth = ctx._depth ?? 0;
  if (depth >= MAX_SUBFLOW_DEPTH) {
    return { ...makeResult("failed", { error: { code: "SUBFLOW_DEPTH", message: `\u5B50\u5DE5\u4F5C\u6D41\u5D4C\u5957\u8D85\u8FC7 ${MAX_SUBFLOW_DEPTH} \u5C42\u4E0A\u9650` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const { createStorage: createStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
  const { createLogger: createLogger2 } = await Promise.resolve().then(() => (init_logger(), logger_exports));
  const { runWorkflow: runWorkflow2 } = await Promise.resolve().then(() => (init_run(), run_exports));
  const sub = await createStorage2().readWorkflow(String(body.workflowName));
  if (!sub) {
    return { ...makeResult("failed", { error: { code: "WORKFLOW_NOT_FOUND", message: `\u5FAA\u73AF\u4F53\u5B50\u5DE5\u4F5C\u6D41\u4E0D\u5B58\u5728: ${body.workflowName}\uFF08\u5148\u5728\u5DE5\u4F5C\u6D41\u9762\u677F\u4FDD\u5B58\uFF0C\u6216\u68C0\u67E5\u540D\u79F0\uFF09` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const myId = String(ctx.currentNodeId ?? "loop");
  const outputs = [];
  for (let i = 0; i < iterations.length; i++) {
    if (ctx.signal?.aborted) {
      return { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u8FD0\u884C\u5DF2\u7531\u7528\u6237\u53D6\u6D88" } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const iterCtx = { ...ctx, vars: { ...ctx.vars ?? {}, loopItem: iterations[i], loopIndex: i } };
    let inputs;
    try {
      inputs = resolveParams(body.inputs ?? {}, iterCtx, myId);
    } catch (e) {
      return { ...makeResult("failed", { error: { code: "DATAFLOW_REF", message: `\u5FAA\u73AF\u4F53\u7B2C ${i + 1} \u8F6E\u8F93\u5165\u89E3\u6790\u5931\u8D25: ${e.message}` } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const { summary } = await runWorkflow2(sub, { logger: createLogger2(), cwd: process.cwd(), inputs, _depth: depth + 1, signal: ctx.signal });
    const endIds = sub.nodes.filter((n) => n.type === "end").map((n) => n.id);
    const endOut = endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null;
    if (summary.status !== "success" && p.onIterationError !== "continue") {
      return { ...makeResult("failed", { error: { code: "LOOP_BODY_FAILED", message: `\u7B2C ${i + 1}/${iterations.length} \u8F6E\u5FAA\u73AF\u4F53\u300C${sub.name}\u300D\u4EE5 ${summary.status} \u7ED3\u675F\u2014\u2014\u5DF2\u5B8C\u6210 ${outputs.length} \u8F6E\uFF0C\u7ED3\u679C\u4FDD\u7559\u5728 out.items \u91CC\uFF08\u8981\u8DF3\u8FC7\u5931\u8D25\u8F6E\u8BF7\u8BBE onIterationError: "continue"\uFF09` } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    outputs.push(summary.status === "success" ? endOut : { error: { code: "SUBFLOW_FAILED", message: `\u7B2C ${i + 1} \u8F6E\u5931\u8D25` }, output: endOut });
  }
  return finish(t0, startedAt, { out: { count: outputs.length, items: outputs } });
}
var loopDef = {
  type: "loop",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      count: { type: "integer", minimum: 0 },
      while: { type: "string" },
      over: { type: "array" },
      maxIterations: { type: "integer", minimum: 1, maximum: 1e5 },
      dangerouslyAllowInfinite: { type: "boolean" },
      // ★ 循环体（方案 A）：每轮调用该子工作流；inputs 里用 {{vars.loopItem}} / {{vars.loopIndex}}
      body: {
        type: "object",
        additionalProperties: false,
        properties: { workflowName: { type: "string", minLength: 1 }, inputs: { type: "object", additionalProperties: true } },
        required: ["workflowName"]
      },
      onIterationError: { enum: ["stop", "continue"] }
    },
    anyOf: [{ required: ["count"] }, { required: ["while"] }, { required: ["over"] }]
  },
  run: async (ctx, p) => safeNodeRun(() => runLoop(p, ctx)),
  describe: () => ({ label: "\u5FAA\u73AF", category: "control" })
};
var logDef = {
  type: "log",
  schema: {
    type: "object",
    required: ["message"],
    additionalProperties: false,
    properties: { level: { enum: ["info", "warn", "error"] }, message: { type: "string" } }
  },
  run: async (_ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const line = `[workflow] ${p.message}`;
    if (p.level === "error") console.error(line);
    else if (p.level === "warn") console.warn(line);
    else console.info(line);
    return finish(t0, startedAt, { out: p.message });
  },
  describe: () => ({ label: "\u65E5\u5FD7", category: "misc" })
};
var manualDef = {
  type: "manual",
  schema: {
    type: "object",
    required: ["prompt"],
    additionalProperties: false,
    properties: { prompt: { type: "string" }, schema: { type: "object" } }
  },
  // 人工确认（2026-10-03 用户拍板「真暂停 + 恢复」）：
  //   交互式运行（HTTP /run）→ 登记挂起并等 POST /run/resume；确认后 out.value = 用户备注。
  //   非交互路径（CLI /workflow 工具、subflow 子工作流内部）→ 无人可点，自动通过 + warning 留痕
  //   （旧实现是 v0.1 空壳：任何场景都立即返回 success，用户反馈「人工确认节点没作用」）。
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const prompt = String(p.prompt ?? "");
    const nodeId = ctx.currentNodeId ?? "";
    const confirmedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!ctx.interactive || !ctx.runId) {
      ctx.logger?.warn("manual \u8282\u70B9\u5728\u975E\u4EA4\u4E92\u73AF\u5883\u81EA\u52A8\u901A\u8FC7\uFF08\u65E0\u4EBA\u53EF\u786E\u8BA4\uFF09", { nodeId, prompt: prompt.slice(0, 120) });
      return finish(t0, startedAt, { out: { prompt, confirmed: true, autoPassed: true, value: "", confirmedAt } });
    }
    ctx.onAwaiting?.({ runId: ctx.runId, nodeId, prompt });
    try {
      const r = await waitForManual({ runId: ctx.runId, nodeId, prompt, createdAt: confirmedAt }, ctx.signal);
      return finish(t0, startedAt, {
        out: { prompt, confirmed: true, value: r.value, confirmedAt: (/* @__PURE__ */ new Date()).toISOString() }
      });
    } catch (e) {
      return {
        ...makeResult("failed", { error: { code: "MANUAL_CANCELLED", message: `\u4EBA\u5DE5\u786E\u8BA4\u672A\u5B8C\u6210\uFF1A${e.message}` } }),
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
  },
  describe: () => ({ label: "\u624B\u52A8\u786E\u8BA4", category: "control" })
};
var mergeDef = {
  type: "merge",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      keys: { type: "array", items: { type: "string" }, description: "\u53EF\u9009\uFF1A\u8F93\u51FA\u952E\u540D\u5217\u8868\uFF08\u6309\u4E0A\u6E38\u987A\u5E8F\uFF09\uFF1B\u7F3A\u7701\u7528\u4E0A\u6E38\u8282\u70B9 id" }
    }
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const my = ctx.currentNodeId ?? "";
    const upstreams = ctx.upstreams?.[my] ?? [];
    if (upstreams.length < 2) {
      return { ...makeResult("failed", { error: { code: "MERGE_NO_UPSTREAM", message: `merge \u9700\u8981\u81F3\u5C11 2 \u6761\u4E0A\u6E38\u8FDE\u7EBF\uFF08\u5F53\u524D ${upstreams.length} \u6761\uFF09\u2014\u2014\u628A\u591A\u4E2A\u5206\u652F\u7684\u8F93\u51FA\u8FDE\u5165 merge \u8282\u70B9` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const out = {};
    upstreams.forEach((uid, i) => {
      const key = p?.keys?.[i] ?? uid;
      out[key] = ctx.results[uid]?.out ?? null;
    });
    return finish(t0, startedAt, { out });
  },
  describe: () => ({ label: "\u5408\u6D41", category: "control" })
};
var MAX_SUBFLOW_DEPTH = 5;
var subflowDef = {
  type: "subflow",
  schema: {
    type: "object",
    required: ["workflowName"],
    additionalProperties: false,
    properties: {
      workflowName: { type: "string", minLength: 1 },
      inputs: { type: "object", additionalProperties: true }
    }
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const q = p;
    const depth = ctx._depth ?? 0;
    if (depth >= MAX_SUBFLOW_DEPTH) {
      return { ...makeResult("failed", { error: { code: "SUBFLOW_DEPTH", message: `\u5B50\u5DE5\u4F5C\u6D41\u5D4C\u5957\u8D85\u8FC7 ${MAX_SUBFLOW_DEPTH} \u5C42\u4E0A\u9650` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    if (ctx.signal?.aborted) {
      return { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u8FD0\u884C\u5DF2\u7531\u7528\u6237\u53D6\u6D88" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const { createStorage: createStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
    const { createLogger: createLogger2 } = await Promise.resolve().then(() => (init_logger(), logger_exports));
    const { runWorkflow: runWorkflow2 } = await Promise.resolve().then(() => (init_run(), run_exports));
    const sub = await createStorage2().readWorkflow(String(q.workflowName ?? ""));
    if (!sub) {
      return { ...makeResult("failed", { error: { code: "WORKFLOW_NOT_FOUND", message: `\u5B50\u5DE5\u4F5C\u6D41\u4E0D\u5B58\u5728: ${q.workflowName}\uFF08\u5148\u5728\u5DE5\u4F5C\u6D41\u9762\u677F\u4FDD\u5B58\uFF0C\u6216\u68C0\u67E5\u540D\u79F0\uFF09` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const { summary } = await runWorkflow2(sub, {
      logger: createLogger2(),
      cwd: process.cwd(),
      inputs: q.inputs ?? {},
      _depth: depth + 1,
      signal: ctx.signal
    });
    const endIds = sub.nodes.filter((n) => n.type === "end").map((n) => n.id);
    const endOut = endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null;
    return finish(t0, startedAt, {
      out: { workflow: sub.name, status: summary.status, totalDurationMs: summary.totalDurationMs, output: endOut, failedCount: summary.failedCount },
      ...summary.status !== "success" ? { error: { code: "SUBFLOW_FAILED", message: `\u5B50\u5DE5\u4F5C\u6D41 "${sub.name}" \u4EE5 ${summary.status} \u72B6\u6001\u7ED3\u675F` } } : {}
    });
  },
  describe: () => ({ label: "\u5B50\u5DE5\u4F5C\u6D41", category: "control" })
};
function getPath(v, dotPath) {
  let cur = v;
  for (const k of dotPath.split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[k];
  }
  return cur;
}
async function runImageGen(p, ctx) {
  const { startedAt, t0 } = startedEnded();
  if (!p.prompt?.trim()) return { ...makeResult("failed", { error: { code: "IMAGE_NO_PROMPT", message: "prompt \u4E3A\u7A7A\u2014\u2014\u586B\u5165\u753B\u9762\u63CF\u8FF0\u540E\u518D\u8BD5" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  if (!p.baseURL?.trim()) return { ...makeResult("failed", { error: { code: "IMAGE_NO_BASEURL", message: "baseURL \u4E3A\u7A7A\u2014\u2014\u586B\u56FE\u7247 API \u5730\u5740\uFF08\u5982 https://dashscope.aliyuncs.com/compatible-mode/v1\uFF09" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  const apiKey = p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] || "" : "");
  if (!apiKey) return { ...makeResult("failed", { error: { code: "IMAGE_NO_KEY", message: "\u7F3A\u5C11 API Key\u2014\u2014\u586B apiKey\uFF0C\u6216\u586B apiKeyEnv \u5F15\u7528\u73AF\u5883\u53D8\u91CF" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  const ac = new AbortController();
  const timeoutMs = p.timeoutMs ?? 12e4;
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const url = `${p.baseURL.replace(/\/+$/, "")}/images/generations`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: p.model ?? "wanx-v1", prompt: p.prompt, size: p.size ?? "1024*1024", n: Math.min(p.n ?? 1, 4) }),
      signal: ac.signal
    });
    const text = await resp.text();
    if (!resp.ok) return { ...makeResult("failed", { error: { code: "IMAGE_API_ERROR", message: `\u56FE\u7247 API \u9519\u8BEF\uFF08HTTP ${resp.status}\uFF09: ${text.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const data = JSON.parse(text);
    const items = data.data ?? [];
    if (items.length === 0) return { ...makeResult("failed", { error: { code: "IMAGE_EMPTY", message: `API \u672A\u8FD4\u56DE\u56FE\u7247\uFF1A${text.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const images = [];
    const prefix = p.filenamePrefix ?? "image";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const fname = `${prefix}-${Date.now()}-${i}.png`;
      if (it.url) {
        const saved = await downloadAsset(it.url, fname);
        images.push({ url: it.url, path: saved.relativePath, bytes: saved.bytes });
      } else if (it.b64_json) {
        const saved = await saveAsset(fname, it.b64_json, "base64");
        images.push({ path: saved.relativePath, bytes: saved.bytes });
      }
    }
    if (images.length === 0) return { ...makeResult("failed", { error: { code: "IMAGE_SAVE_FAILED", message: "API \u8FD4\u56DE\u7684\u56FE\u7247\u65E2\u65E0 url \u4E5F\u65E0 b64_json" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    void ctx;
    return finish(t0, startedAt, { out: { images, count: images.length } });
  } catch (e) {
    if (e.name === "AbortError") return { ...makeResult("failed", { error: { code: "IMAGE_TIMEOUT", message: `\u56FE\u7247\u751F\u6210\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    return { ...makeResult("failed", { error: { code: "IMAGE_ERROR", message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  } finally {
    clearTimeout(t);
  }
}
var imageGenDef = {
  type: "image_generate",
  schema: {
    type: "object",
    required: ["prompt", "baseURL"],
    additionalProperties: false,
    properties: {
      prompt: { type: "string", minLength: 1 },
      baseURL: { type: "string", minLength: 1 },
      model: { type: "string" },
      apiKey: { type: "string" },
      apiKeyEnv: { type: "string" },
      size: { type: "string" },
      n: { type: "integer", minimum: 1, maximum: 4 },
      filenamePrefix: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1e3 }
    }
  },
  run: async (ctx, p) => safeNodeRun(() => runImageGen(p, ctx)),
  describe: () => ({ label: "\u56FE\u7247\u751F\u6210", category: "media" })
};
async function runVideoGen(p, ctx) {
  const { startedAt, t0 } = startedEnded();
  const apiKey = p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] || "" : "");
  const headers = { "content-type": "application/json", ...p.submitHeaders ?? {} };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (!p.submitUrl?.trim()) return { ...makeResult("failed", { error: { code: "VIDEO_NO_SUBMIT", message: "submitUrl \u4E3A\u7A7A\u2014\u2014\u586B\u89C6\u9891 API \u7684\u4EFB\u52A1\u63D0\u4EA4\u5730\u5740" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  if (!p.pollUrl?.trim()) return { ...makeResult("failed", { error: { code: "VIDEO_NO_POLL", message: "pollUrl \u4E3A\u7A7A\u2014\u2014\u586B\u4EFB\u52A1\u67E5\u8BE2\u5730\u5740\uFF08\u53EF\u542B {taskId} \u5360\u4F4D\uFF09" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  const interval = Math.max(p.pollIntervalMs ?? 5e3, 1e3);
  const maxWait = Math.max(p.maxWaitMs ?? 6e5, interval);
  const statusPath = p.statusPath ?? "output.task_status";
  const doneValue = p.doneValue ?? "succeeded";
  const videoUrlPath = p.videoUrlPath ?? "output.video_url";
  try {
    const sr = await fetch(p.submitUrl, {
      method: p.submitMethod ?? "POST",
      headers,
      body: JSON.stringify(p.submitBody ?? {})
    });
    const stext = await sr.text();
    if (!sr.ok) return { ...makeResult("failed", { error: { code: "VIDEO_SUBMIT_ERROR", message: `\u4EFB\u52A1\u63D0\u4EA4\u5931\u8D25\uFF08HTTP ${sr.status}\uFF09: ${stext.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const sjson = JSON.parse(stext);
    const taskId = String(getPath(sjson, p.taskIdPath ?? "output.task_id") ?? "");
    if (!taskId) return { ...makeResult("failed", { error: { code: "VIDEO_NO_TASK", message: `\u63D0\u4EA4\u54CD\u5E94\u4E2D\u672A\u627E\u5230\u4EFB\u52A1 ID\uFF08taskIdPath \u4E0D\u5BF9\uFF1F\uFF09\uFF1A${stext.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const pollHeaders = { ...p.pollHeaders ?? {} };
    if (apiKey && !pollHeaders.authorization) pollHeaders.authorization = `Bearer ${apiKey}`;
    const deadline = Date.now() + maxWait;
    let lastStatus = "";
    let videoUrl = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (ctx.signal?.aborted) return { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u89C6\u9891\u8F6E\u8BE2\u671F\u95F4\u8FD0\u884C\u88AB\u53D6\u6D88" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const pollUrl = p.pollUrl.includes("{taskId}") ? p.pollUrl.replace("{taskId}", encodeURIComponent(taskId)) : p.pollUrl;
      const pr = await fetch(pollUrl, { headers: pollHeaders });
      const pj = await pr.json().catch(() => ({}));
      lastStatus = String(getPath(pj, statusPath) ?? "");
      const vu = getPath(pj, videoUrlPath);
      if (typeof vu === "string" && vu) videoUrl = vu;
      if (videoUrl || lastStatus && lastStatus !== "running" && lastStatus !== "pending" && lastStatus !== "PENDING" && lastStatus !== "RUNNING" && lastStatus !== doneValue) break;
    }
    if (!videoUrl) {
      return { ...makeResult("failed", { error: { code: "VIDEO_NOT_READY", message: `\u8F6E\u8BE2 ${Math.round(maxWait / 1e3)}s \u540E\u4ECD\u672A\u5B8C\u6210\uFF08\u6700\u540E\u72B6\u6001\uFF1A${lastStatus || "unknown"}\uFF09\u3002\u589E\u5927 maxWaitMs \u6216\u68C0\u67E5\u4EFB\u52A1\u72B6\u6001` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const saved = await downloadAsset(videoUrl, p.filename ?? `video-${Date.now()}.mp4`);
    return finish(t0, startedAt, {
      out: { taskId, videoUrl, path: saved.relativePath, bytes: saved.bytes, waitedMs: Date.now() - t0 }
    });
  } catch (e) {
    return { ...makeResult("failed", { error: { code: "VIDEO_ERROR", message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
}
var videoGenDef = {
  type: "video_generate",
  schema: {
    type: "object",
    required: ["submitUrl", "pollUrl"],
    additionalProperties: false,
    properties: {
      submitUrl: { type: "string", minLength: 1 },
      submitMethod: { type: "string" },
      submitHeaders: { type: "object", additionalProperties: { type: "string" } },
      submitBody: { type: "object", additionalProperties: true },
      taskIdPath: { type: "string" },
      pollUrl: { type: "string", minLength: 1 },
      pollHeaders: { type: "object", additionalProperties: { type: "string" } },
      pollIntervalMs: { type: "integer", minimum: 1e3 },
      maxWaitMs: { type: "integer", minimum: 1e3 },
      statusPath: { type: "string" },
      doneValue: { type: "string" },
      videoUrlPath: { type: "string" },
      filename: { type: "string" },
      apiKey: { type: "string" },
      apiKeyEnv: { type: "string" }
    }
  },
  run: async (ctx, p) => safeNodeRun(() => runVideoGen(p, ctx)),
  describe: () => ({ label: "\u89C6\u9891\u751F\u6210", category: "media" })
};
var fileSaveDef = {
  type: "file_save",
  schema: {
    type: "object",
    required: ["filename"],
    additionalProperties: false,
    properties: {
      source: { enum: ["text", "base64", "url"] },
      content: { type: "string" },
      url: { type: "string" },
      filename: { type: "string", minLength: 1 }
    }
  },
  run: async (_ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const source = p.source ?? (p.url ? "url" : "text");
    try {
      if (source === "url") {
        if (!p.url?.trim()) return { ...makeResult("failed", { error: { code: "FILE_NO_URL", message: "url \u4E3A\u7A7A\u2014\u2014\u586B\u8981\u4E0B\u8F7D\u7684\u6587\u4EF6\u5730\u5740\uFF08\u53EF\u5F15\u7528\u4E0A\u6E38 {{u.out.url}}\uFF09" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
        const saved2 = await downloadAsset(p.url, p.filename);
        return finish(t0, startedAt, { out: { path: saved2.relativePath, ...saved2, source: "url" } });
      }
      if (source === "base64" && !p.content) return { ...makeResult("failed", { error: { code: "FILE_NO_CONTENT", message: "base64 \u5185\u5BB9\u4E3A\u7A7A" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
      if (source === "text" && !p.content?.trim()) return { ...makeResult("failed", { error: { code: "FILE_NO_CONTENT", message: "content \u4E3A\u7A7A\u2014\u2014\u586B\u6587\u4EF6\u5185\u5BB9\uFF08\u53EF\u5F15\u7528\u4E0A\u6E38 {{u.out.xxx}}\uFF09" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const saved = await saveAsset(p.filename, p.content ?? "", source === "base64" ? "base64" : "utf8");
      return finish(t0, startedAt, { out: { path: saved.relativePath, ...saved, source, preview: source === "text" ? String(p.content).slice(0, 200) : void 0 } });
    } catch (e) {
      return { ...makeResult("failed", { error: { code: "FILE_SAVE_ERROR", message: `${e.message}\uFF08\u68C0\u67E5 filename \u662F\u5426\u542B\u975E\u6CD5\u5B57\u7B26\uFF09` } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
  },
  describe: () => ({ label: "\u6587\u4EF6\u4FDD\u5B58", category: "media" })
};
async function runWebSearchNode(p, ctx) {
  const { startedAt, t0 } = startedEnded();
  if (!String(p.query ?? "").trim()) {
    return { ...makeResult("failed", { error: { code: "SEARCH_EMPTY_QUERY", message: "query \u4E3A\u7A7A\u2014\u2014\u641C\u7D22\u8282\u70B9\u672A\u6267\u884C\uFF0C\u6D41\u7A0B\u5DF2\u5728\u6B64\u4E2D\u65AD\u3002\u586B\u5165\u641C\u7D22\u8BCD\u6216\u68C0\u67E5\u4E0A\u6E38\u8F93\u51FA" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  if (ctx.signal?.aborted) {
    return { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u8FD0\u884C\u5DF2\u7531\u7528\u6237\u53D6\u6D88" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  try {
    const outcome = await runWebSearch(
      { query: p.query, provider: p.provider, count: p.count, lang: p.lang, timeRange: p.timeRange, searxngInstances: p.searxngInstances },
      ctx.signal
    );
    return finish(t0, startedAt, {
      out: { query: p.query, engine: outcome.engine, viaHost: outcome.viaHost, count: outcome.results.length, results: outcome.results }
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    if (msg === "\u8FD0\u884C\u5DF2\u88AB\u53D6\u6D88" || ctx.signal?.aborted) {
      return { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u641C\u7D22\u671F\u95F4\u8FD0\u884C\u88AB\u53D6\u6D88" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    return { ...makeResult("failed", { error: { code: "SEARCH_FAILED", message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
}
var webSearchDef = {
  type: "web_search",
  schema: {
    type: "object",
    required: ["query"],
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1 },
      provider: { enum: ["auto", "host", "bing", "ddg", "ddg-lite", "searxng", "anysearch"] },
      count: { type: "integer", minimum: 1, maximum: 20 },
      lang: { type: "string" },
      timeRange: { enum: ["day", "week", "month", "year"] },
      searxngInstances: { type: "array", items: { type: "string" } }
    }
  },
  run: async (ctx, p) => safeNodeRun(() => runWebSearchNode(p, ctx)),
  describe: () => ({ label: "\u7F51\u9875\u641C\u7D22", category: "io" })
};
async function runWebFetchNode(p, ctx) {
  const { startedAt, t0 } = startedEnded();
  if (!String(p.url ?? "").trim()) {
    return { ...makeResult("failed", { error: { code: "FETCH_NO_URL", message: "url \u4E3A\u7A7A\u2014\u2014\u6293\u53D6\u8282\u70B9\u672A\u6267\u884C\uFF0C\u6D41\u7A0B\u5DF2\u5728\u6B64\u4E2D\u65AD\u3002\u586B\u5165\u7F51\u5740\u6216\u5F15\u7528\u4E0A\u6E38 {{u.out.url}}" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  if (ctx.signal?.aborted) {
    return { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u8FD0\u884C\u5DF2\u7531\u7528\u6237\u53D6\u6D88" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  try {
    const r = await runWebFetch({ url: p.url, maxChars: p.maxChars, timeoutMs: p.timeoutMs, raw: p.raw }, ctx.signal);
    return finish(t0, startedAt, {
      out: { url: r.url, status: r.status, contentType: r.contentType, mode: r.mode, chars: r.chars, ...r.mode === "json" ? { json: r.json } : { text: r.text } }
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    if (msg === "\u8FD0\u884C\u5DF2\u88AB\u53D6\u6D88" || ctx.signal?.aborted) {
      return { ...makeResult("failed", { error: { code: "RUN_CANCELLED", message: "\u6293\u53D6\u671F\u95F4\u8FD0\u884C\u88AB\u53D6\u6D88" } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    if (e.name === "FetchTimeout") {
      return { ...makeResult("failed", { error: { code: "FETCH_TIMEOUT", message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    return { ...makeResult("failed", { error: { code: "FETCH_FAILED", message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
}
var webFetchDef = {
  type: "web_fetch",
  schema: {
    type: "object",
    required: ["url"],
    additionalProperties: false,
    properties: {
      url: { type: "string", minLength: 1 },
      maxChars: { type: "integer", minimum: 200, maximum: 2e5 },
      timeoutMs: { type: "integer", minimum: 1e3, maximum: 3e5 },
      raw: { type: "boolean" }
    }
  },
  run: async (ctx, p) => safeNodeRun(() => runWebFetchNode(p, ctx)),
  describe: () => ({ label: "\u7F51\u9875\u6293\u53D6", category: "io" })
};
function registerBuiltinNodes() {
  for (const d of [startDef, endDef, pythonDef, bashDef, subagentDef, sessionInputDef, httpDef, setVarDef, ifDef, switchDef, loopDef, logDef, manualDef, mergeDef, subflowDef, imageGenDef, videoGenDef, fileSaveDef, webSearchDef, webFetchDef]) {
    WorkflowNodeRegistry.register(d);
  }
}

// tmp-test/run-simple-workflow.mjs
registerBuiltinNodes();
var def = {
  name: "smoke-simple",
  version: 1,
  nodes: [
    { id: "start", type: "start", params: {}, next: "py" },
    { id: "py", type: "python", params: { code: "print('hello from dag-flow')", timeoutMs: 15e3 }, next: "end" },
    { id: "end", type: "end" }
  ]
};
async function main() {
  const logger = { info() {
  }, warn() {
  }, error() {
  }, debug() {
  }, trace() {
  } };
  const result = await runWorkflow(def, { logger, cwd: process.cwd() });
  const s = result.summary;
  console.log("status:", s.status);
  console.log("totalDurationMs:", s.totalDurationMs);
  for (const [id, r] of Object.entries(s.results ?? {})) {
    console.log(`  ${id}: ${r.status}${r.output ? " | " + String(r.output).trim().slice(0, 80) : ""}${r.error ? " | err: " + String(r.error?.message ?? r.error).slice(0, 120) : ""}`);
  }
  return s.status;
}
main().then((status) => process.exit(status === "success" ? 0 : 2)).catch((e) => {
  console.error("\u6267\u884C\u5668\u5F02\u5E38:", e?.message ?? e);
  process.exit(3);
});
/*! Bundled license information:

expr-eval/dist/bundle.js:
  (*!
     Based on ndef.parser, by Raphael Graf(r@undefined.ch)
     http://www.undefined.ch/mparser/index.html
  
     Ported to JavaScript and modified by Matthew Crumley (email@matthewcrumley.com, http://silentmatt.com/)
  
     You are free to use and modify this code in anyway you find useful. Please leave this comment in the code
     to acknowledge its original source. If you feel like it, I enjoy hearing about projects that use my code,
     but don't feel like you have to let me know or ask permission.
    *)
*/
