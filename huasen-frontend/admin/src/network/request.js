/*
 * @Autor: huasenjio
 * @Date: 2021-08-25 01:53:35
 * @LastEditors: huasenjio
 * @LastEditTime: 2023-03-26 21:32:28
 * @Description: 自动实现注册mock随机数据的请求工具
 */

const Mock = require('mockjs2');
import Config from './config.js';
import { http } from './http.js';

/**
 * get请求方法
 * @param {string}  url       接口地址 必填
 * @param {object}  mockData  随机数据（硬编码对象｜Mock数据格式｜函数）选填
 * @param {boolean} FWS       数据模拟功能开关 选填
 */
export function get(url, mock, FSW = true) {
  let isMock = null;
  if (Config.globalMock) {
    // 传递有mock格式才生效
    if (typeof mock == 'object' || typeof mock == 'function') {
      // 开关精准控制
      if (FSW) {
        let u = url;
        let regExpText = u.replace(/\//g, '\\/');
        Mock.mock(new RegExp(regExpText), 'get', mock);
        isMock = true;
      }
    }
  }
  return function (params, option = {}) {
    // 可取消标识
    if (option._cancelable) option.cancelToken = Config.cancelToken;
    // 是否是Mock请求
    if (isMock) option._isMock = isMock;
    // 配置提示
    option._notify = Object.prototype.hasOwnProperty.call(option, 'notify') ? option.notify : Config.globalNotify;
    // 配置错误提示
    option._errorNotify = Object.prototype.hasOwnProperty.call(option, 'errorNotify') ? option.errorNotify : Config.globalErrorNotify;
    return http({
      url,
      params,
      ...option,
      method: 'get',
    });
  };
}

/**
 * post请求方法
 * @param {string}  url       接口地址 必填
 * @param {object}  mockData  随机数据（硬编码对象｜Mock数据格式｜函数）选填
 * @param {boolean} FWS       数据模拟功能开关 选填
 */
export function post(url, mock, FSW = true) {
  let isMock = null;
  if (Config.globalMock) {
    // 传递有mock格式才生效
    if (typeof mock == 'object' || typeof mock == 'function') {
      // 开关精准控制
      if (FSW) {
        let u = url;
        let regExpText = u.replace(/\//g, '\\/');
        Mock.mock(new RegExp(regExpText), 'post', mock);
        isMock = true;
      }
    }
  }
  return function (data, option = {}) {
    // 可取消标识
    if (option._cancelable) option.cancelToken = Config.cancelToken;
    // 是否是Mock请求
    if (isMock) option._isMock = isMock;
    // 配置提示
    option._notify = Object.prototype.hasOwnProperty.call(option, 'notify') ? option.notify : Config.globalNotify;
    // 加密传输
    option._secret = Object.prototype.hasOwnProperty.call(option, 'secret') ? option.secret : Config.globalSecret;
    // 配置错误提示
    option._errorNotify = Object.prototype.hasOwnProperty.call(option, 'errorNotify') ? option.errorNotify : Config.globalErrorNotify;
    return http({
      url,
      data,
      ...option,
      method: 'post',
    });
  };
}

/**
 * 上传请求方法
 * @param {string} url - 接口地址
 */
export function upload(url) {
  return function (data, option = {}) {
    return http({
      ...option,
      url,
      data,
      method: 'post',
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  };
}

/**
 * URL链接形式下载文件
 * @param {string} url - 接口地址 
 * @param {string} filename - 文件名称，必须带有后缀
 */
export function downloadFileByUrl(url, filename) {
  let a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', filename);
  a.setAttribute('target', '_blank');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 二进制流形式下载文件
 * @param {string} url - 接口地址
 * @param {object} data - 参数对象
 * @param {string} fileName - 文件名称，必须带有后缀
 * @param {mine} MIME - 文件类型，如：application/zip
 * @param {function} callback - 回调函数
 * @returns 
 */
export function downloadFileByBlob(url, data, fileName, MIME, callback) {
  return http({
    url,
    data,
    method: 'post',
    responseType: 'blob',
    timeout: 360000, // 调整超时时间为60秒，防止文件过大，导致请求取消
  })
    .then(result => {
      // 执行回调
      if (callback) callback(result);
      let a = document.createElement('a');
      // result必须是二进制流对象
      let blobData = result;
      // 设置类型
      let blob = new Blob([blobData], { type: MIME });
      const url = window.URL.createObjectURL(blob);
      a.href = url;
      a.style.display = 'none';
      // 设置文件名称
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 垃圾回收，减少页面内存消耗
      window.URL.revokeObjectURL(a.href);
    })
    .catch(err => {
      alert('下载流文件失败');
    });
}
