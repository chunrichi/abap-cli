// util.isObject/isString 在 Node 22 弃用、23+ 移除，abap-adt-api 仍在使用。
// 通过 CJS require 修改 util 导出，让包内 require('util') 能读到这些函数。
import { createRequire } from 'node:module';

const util = createRequire(import.meta.url)('util') as Record<string, unknown>;

if (typeof util.isObject !== 'function') {
  util.isObject = (value: unknown) => typeof value === 'object' && value !== null;
}
if (typeof util.isString !== 'function') {
  util.isString = (value: unknown) => typeof value === 'string';
}
if (typeof util.isArray !== 'function') {
  util.isArray = (value: unknown) => Array.isArray(value);
}
