import * as enumHelper from '@/utils/enumHelper';
import computeTypeFuncs from '@/views/dataManage/utils/computeTypeFuncs';

/**
 * 节点的类型：
 *  @param {String} VARIABLE 变量
 *  @param {String} FUNCTION 函数
 *  @param {String} BINARY_EXP 二元运算符
 *  @param {String} NUMBER 数字
 *  @param {String} STRING 字符串
 */

// UTF-16编码
const OPEN_PAREN_CODE = 40; // (
const CLOSE_PAREN_CODE = 41; // )
const SINGLE_QUOTE_CODE = 39; // 单引号 ''
const DOUBLE_QUOTE_CODE = 34; // 双引号 ""
const SPACE_CODES = [32, 9, 10, 13]; // 空格、双空格、换行、空白字符。
const PERID_CODE = 46; // .
const COMMA_CODE = 44; // ,

// 一元运算符
const UNARY_operatorS = { '!': true };
// 二元运算符
const LOGICAL_OPERATORS = ['||', '&&', '===', '!==', '>', '<', '>=', '<='];
const BINARY_OPERATORS = {
    '||': 1,
    '&&': 2,
    '===': 6,
    '!==': 6,
    '>': 7,
    '<': 7,
    '<=': 7,
    '>=': 7,
    '+': 9,
    '-': 9,
    '*': 10,
    '/': 10,
    '%': 10
};

// 获取对象“键”的最大长度
const getMaxKeyLen = function(obj) {
    let max = 0;
    Object.keys(obj).forEach(key => {
        if (key.length > max && Object.prototype.hasOwnProperty.call(obj, key)) {
            max = key.length;
        }
    });
    return max;
};

const maxUnaryOperateLength = getMaxKeyLen(UNARY_operatorS);
const maxBinaryOperatorLength = getMaxKeyLen(BINARY_OPERATORS);

class ExpressParser {
    /**
     * 表达式解析器构造函数
     * @param {String} expr 必选参数 需要解析的表达式
     * @param {Object[]} fieldList 可选参数 需要过滤的字段
     * @param {Object[]} funcList  可选参数，函数列表
     */
    constructor(expr, fieldList = [], funcList = []) {
        if (typeof expr !== 'string') {
            throw new Error(`[expression-parser] constructor need a string parameter, but get ${typeof expr}`);
        }
        this.expr = expr;
        this.fieldList = fieldList;
        this.funcList = funcList;
    }

    parseSync() {
        this.index = 0;
        try {
            this.tokens = this.eatExpression();
            if (this.index < this.expr.length) {
                throw new Error(`非法字符“${this.charAt()}”`);
            }
            this.analysis();
        } catch (error) {
            throw new Error(error.message);
        }

        return this.tokens;
    }

    //---------------------------------表达式解析为语法树---------------------------------------

    parse() {
        return new Promise((resolve, reject) => {
            this.index = 0;
            try {
                // 表达式解析
                this.tokens = this.eatExpression();
                if (this.index < this.expr.length) {
                    throw new Error(`非法字符“${this.charAt()}”`);
                }

                // 语法树分析
                this.analysis();

                resolve(this);
            } catch (error) {
                reject(error.message);
            }
        });
    }

    /**
     * 表达式解析
     * 将this.expr变量存储的表达式解析为语法树。对'方法调用'等进行递归解析。
     * @example
     * this.expr = " avg(count(F8) + 3) + 'teststr' ";
     * // =>
     * {
     *    left: {
     *       params: [{
     *          type: "VARIABLE", value: "F8", raw: "F8"
     *       }]
     *    },
     *    operator: "+"
     *    right: {
     *       type: "STRING", value: "teststr", raw: "'teststr'"
     *    }
     * }
     */
    eatExpression() {
        // 1、解析左侧运算表达式
        let left = this.eatToken();

        // 2、解析操作符
        let operator = this.eatBinaryOperator();
        if (typeof left !== 'undefined' && !operator) {
            // 说明这个运算树只有左侧
            return left;
        } else if (typeof left === 'undefined' && operator) {
            throw new Error(`"${operator}"运算符前应该为表达式`);
        }
        let operatorInfo = {
            procedence: this.getOperatorPrecedence(operator), // 运算符优先级
            value: operator
        };

        // 3、解析右侧运算表达式
        let right = this.eatToken();
        if (!right) {
            throw new Error(`"${operator}"运算符后应该为表达式`);
        }

        // 创造一个运算栈
        const stack = [left, operatorInfo, right];
        // 获取下一个运算符
        while ((operator = this.eatBinaryOperator())) {
            const procedence = this.getOperatorPrecedence(operator);
            if (procedence === 0) {
                break;
            }

            operatorInfo = {
                procedence,
                value: operator
            };

            while (stack.length > 2 && procedence < stack[stack.length - 2].procedence) {
                right = stack.pop();
                operator = stack.pop().value;
                left = stack.pop();
                const node = this.createNode(operator, left, right);
                stack.push(node);
            }

            const node = this.eatToken();
            if (!node) {
                throw new Error(`"${operator}"运算符后应该为表达式`);
            }
            stack.push(operatorInfo, node);
        }
        let i = stack.length - 1;
        let node = stack[i];

        while (i > 1) {
            node = this.createNode(stack[i - 1].value, stack[i - 2], node);
            i -= 2;
        }
        return node;
    }

    // 词法分析
    eatToken() {
        this.eatSpaces();
        const ch = this.charCodeAt();
        if (this.isDigit(ch) || ch === PERID_CODE) {
            // 数字
            return this.eatNumber();
        } else if (ch === SINGLE_QUOTE_CODE || ch === DOUBLE_QUOTE_CODE) {
            // 字符串
            return this.eatString();
        } else if (ch === OPEN_PAREN_CODE) {
            // 括号
            return this.eatGroup();
        }

        let check = this.expr.substring(this.index);
        const funcReg = /^[A-Za-z]([A-Za-z]|\d)*\(/;
        const varReg = /^[A-Za-z]([A-Za-z]|\d)*/;

        if (funcReg.test(check)) {
            // 函数
            return this.eatFunc();
        } else if (varReg.test(check)) {
            // 变量
            return this.eatVariable();
        } else {
            // 检查单操作符 ！+ -
            let toCheck = this.expr.substring(this.index, this.index + maxUnaryOperateLength);
            let toCheckLength = 0;
            while ((toCheckLength = toCheck.length)) {
                if (Object.prototype.hasOwnProperty.call(UNARY_operatorS, toCheck) && this.index + toCheckLength <= this.expr.length) {
                    this.index += toCheckLength;
                    return {
                        type: 'UNARY_EXP',
                        operator: toCheck,
                        argument: this.eatToken()
                    };
                }
                toCheck = toCheck.substr(0, --toCheckLength);
            }
        }
    }

    // 解析空格
    eatSpaces() {
        let ch = this.charCodeAt();
        while (SPACE_CODES.indexOf(ch) !== -1) {
            ch = this.charCodeAt(++this.index);
        }
    }

    // 解析数字
    eatNumber() {
        let number = '';

        // 数字开头
        while (this.isDigit(this.charCodeAt())) {
            number += this.charAt(this.index++);
        }

        if (this.charCodeAt() === PERID_CODE) {
            number += this.charAt(this.index++);
            while (this.isDigit(this.charCodeAt())) {
                number += this.charAt(this.index++);
            }
        }

        return {
            type: 'NUMBER',
            value: parseFloat(number),
            raw: number
        };
    }

    // 解析字符串
    eatString() {
        let str = '';
        const quote = this.charAt();
        let closed = false;
        while (this.index < this.expr.length) {
            let ch = this.charAt(++this.index);
            if (ch === quote) {
                this.index++; // 跳过结尾‘'’
                closed = true;
                break;
            } else if (ch === '\\') {
                ch = this.charAt(this.index++);
                // 检查所有常见的转义码
                switch (ch) {
                    case 'n':
                        str += '\n';
                        break;
                    case 'r':
                        str += '\r';
                        break;
                    case 't':
                        str += '\t';
                        break;
                    case 'b':
                        str += '\b';
                        break;
                    case 'f':
                        str += '\f';
                        break;
                    case 'v':
                        str += '\x08';
                        break;
                    default:
                        str += ch;
                }
            } else {
                str += ch;
            }
        }

        if (!closed) {
            throw new Error(`字符${str}缺少闭合括号`);
        }

        return {
            type: 'STRING',
            value: str,
            raw: quote + str + quote
        };
    }

    // 解析函数
    eatFunc() {
        // 函数名解析
        const start = this.index;
        while (this.index < this.expr.length) {
            const ch = this.charCodeAt();
            if (this.isVariablePart(ch)) {
                this.index++;
            } else {
                break;
            }
        }
        const identifier = this.expr.slice(start, this.index);

        // 参数解析
        this.index++; // 跳过 “(”
        const params = [];

        if (this.index < this.expr.length) {
            while (this.index < this.expr.length) {
                this.eatSpaces();

                let ch = this.charCodeAt(this.index);
                if (ch === CLOSE_PAREN_CODE) {
                    this.index++;
                    break;
                }

                // 解析函数内部的字段
                const node = this.eatExpression();
                if (node) {
                    params.push(node);
                }

                this.eatSpaces();
                ch = this.charCodeAt();
                if (ch === COMMA_CODE) {
                    this.index++; // 跳过 ","
                    // break;
                } else if (ch === CLOSE_PAREN_CODE) {
                    this.index++;
                    break;
                } else {
                    throw new Error(`函数${identifier}没有闭合`);
                }
            }
        } else {
            throw new Error(`函数${identifier}没有闭合`);
        }

        return {
            type: 'FUNCTION',
            value: identifier,
            raw: identifier,
            params: params
        };
    }

    // 解析变量
    eatVariable() {
        const start = this.index;
        while (this.index < this.expr.length) {
            const ch = this.charCodeAt();
            if (this.isVariablePart(ch)) {
                this.index++;
            } else {
                break;
            }
        }

        const identifier = this.expr.slice(start, this.index);
        return {
            type: 'VARIABLE',
            value: identifier,
            raw: identifier
        };
    }

    // 解析圆括号
    eatGroup() {
        this.index++; // 跳过 “(”
        const node = this.eatExpression();
        this.eatSpaces();
        const ch = this.charCodeAt();
        if (ch !== CLOSE_PAREN_CODE) {
            throw new Error('括号没有闭合');
        } else {
            this.index++; // 跳过 ")"
            return node;
        }
    }

    /**
     *  解析二元操作符
     *  @return {String} 匹配到的操作符
     */
    eatBinaryOperator() {
        this.eatSpaces();
        // 根据“二元操作符”可能的最大长度进行截取
        let toCheck = this.expr.substring(this.index, this.index + maxBinaryOperatorLength);
        let toCheckLength = toCheck.length;
        // 将截取的字符串循环匹配
        while (toCheckLength) {
            if (Object.prototype.hasOwnProperty.call(BINARY_OPERATORS, toCheck) && this.index + toCheckLength <= this.expr.length) {
                this.index += toCheckLength;
                return toCheck;
            }
            toCheck = toCheck.substring(0, --toCheckLength);
        }
        return false;
    }

    //------------------------下面是解析用到的工具函数----------------------------------------------
    createNode(operator, left, right) {
        const type = LOGICAL_OPERATORS.indexOf(operator) !== -1 ? 'LOGICAL_EXP' : 'BINARY_EXP';
        return {
            type,
            operator,
            left,
            right
        };
    }

    /**
     * 获取当前遍历字符
     * @param {number} index
     */
    charAt(index = this.index) {
        return this.expr.charAt(index);
    }

    /**
     * 获取当前字符的Unicode编码
     * @param {number} index
     */
    charCodeAt(index = this.index) {
        return this.expr.charCodeAt(index);
    }

    // 判断当前字符是不是数字
    isDigit(ch) {
        return ch >= 48 && ch <= 57; // 0...9
    }

    // 判断是否是变量的一部分
    isVariablePart(ch) {
        return (
            (ch >= 65 && ch <= 90) || // A...Z
            (ch >= 97 && ch <= 122) || // a...z
            (ch >= 48 && ch <= 57)
        ); // 0...9
    }

    // 获取运算符优先级
    getOperatorPrecedence(operator) {
        return BINARY_OPERATORS[operator] || 0;
    }

    // ------------------------和业务相关联------------------------------------------

    /**
     * 对语法树进行业务分析，包含限定词、限定的参数等
     * 对eatExpression()解析获得的语法树进行限定词分析
     */
    analysis() {
        if (this.fieldList.length > 0 || this.funcList.length > 0) {
            this.limitAnalysis(this.tokens);
        }
    }
    /**
     * 对语法树进行递归限定分析
     * 通过对 (变量|函数) 进行限定比较，看输入的变量或者表达式是否超出我们提供的范围
     */
    limitAnalysis(obj) {
        let findItem = '';
        switch (obj.type) {
            case 'VARIABLE':
                // 变量
                findItem = this.fieldList.find(i => {
                    if (obj.value === i.col) return i;
                });
                if (!findItem) {
                    throw new Error(`字段“${obj.value}”查找不到`);
                }
                break;
            case 'FUNCTION':
                // 函数
                findItem = this.funcList.find(i => {
                    if (obj.value === i.func) return i;
                });
                if (!findItem) {
                    throw new Error(`函数“${obj.value}”查找不到`);
                }
                obj.params.forEach(i => {
                    this.limitAnalysis(i);
                });
                break;
            case 'BINARY_EXP':
                this.limitAnalysis(obj.left);
                this.limitAnalysis(obj.right);
                break;
            default:
                break;
        }
    }

    /**
     * token解析好之后，根据传入的变量来计算表达式的值
     * @param {Array} 传入的变量
     * @return {*} 最终表达式计算好的值
     */
    valueOf(scope = {}) {
        // 先进行表达式解析
        this.parseSync();

        if (this.tokens === null) {
            return undefined;
        }
        const value = this.getNodeValue(this.tokens, scope);
        return value;
    }

    /**
     * 递归计算当前节点的值
     * @param {*} node 当前计算的节点
     * @param {*} scope 节点变量映射对象
     */
    getNodeValue(node, scope = {}) {
        // 节点可能包含的属性
        const { type, value, left, right, operator, params } = node;
        if (type === 'FUNCTION') {
            // 根据函数名称在计算函数列表中查找详细的函数信息
            const computeType = enumHelper.findComputeTypeByName(value);
            // 对于函数，是由前端计算或者服务端计算
            if (computeType && computeType.use) {
                // 根据服务端返回的计算结果， 判断变量和函数名称是否相同，返回计算值
                const paramName = params[0].value;
                // return value === scope[paramName].aggType ? scope[paramName].value : 0;
                return scope[paramName].value;
            } else if (computeType && !computeType.use) {
                // 在前端使用的计算函数继续解析
                const paramsValue = [];
                params.forEach(i => {
                    const value = this.getNodeValue(i, scope);
                    paramsValue.push(value);
                });

                const computeFuc = computeTypeFuncs[value];
                return computeFuc(...paramsValue);
            }
        } else if (type === 'VARIABLE') {
            return scope[value].value;
        } else if (type === 'NUMBER' || type === 'STRING') {
            return value;
        } else if (type === 'LOGICAL_EXP') {
            const leftValue = this.getNodeValue(left, scope);
            // 如果是逻辑运算的&&和||，那么可能不需要解析右边的值
            if (operator === '&&' && !leftValue) {
                return false;
            }
            if (operator === '||' && !!leftValue) {
                return true;
            }
            const rightValue = this.getNodeValue(right, scope);
            switch (node.operator) {
                case '&&':
                    return leftValue && rightValue;
                case '||':
                    return leftValue || rightValue;
                case '>':
                    return leftValue > rightValue;
                case '>=':
                    return leftValue >= rightValue;
                case '<':
                    return leftValue < rightValue;
                case '<=':
                    return leftValue <= rightValue;
                case '===':
                    return leftValue === rightValue;
                case '!==':
                    return leftValue !== rightValue;
            }
        } else if (type === 'BINARY_EXP') {
            const leftValue = this.getNodeValue(left, scope);
            const rightValue = this.getNodeValue(right, scope);
            switch (node.operator) {
                case '+':
                    return leftValue + rightValue;
                case '-':
                    return leftValue - rightValue;
                case '*':
                    return leftValue * rightValue;
                case '/':
                    return leftValue - rightValue;
                case '%':
                    return leftValue % rightValue;
                // skip default case
            }
        } else if (type === 'UNARY_EXP') {
            switch (node.operator) {
                case '!':
                    return !this.getNodeValue(node.argument, scope);
                case '+':
                    return +this.getNodeValue(node.argument, scope);
                case '-':
                    return -this.getNodeValue(node.argument, scope);
                // skip default case
            }
        }
    }
}

export default ExpressParser;
