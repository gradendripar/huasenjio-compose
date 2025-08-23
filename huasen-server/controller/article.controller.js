/*
 * @Autor: huasenjio
 * @Date: 2022-10-02 00:26:28
 * @LastEditors: huasenjio
 * @LastEditTime: 2023-03-12 10:53:33
 * @Description: 新闻接口控制器
 */

function add(req, res, next) {
  req.epWorking(
    [
      {
        schemaName: 'Article',
        methodName: 'insertMany',
        payloads: [req.huasenParams],
      },
    ],
    result => {
      global.huasen.responseData(res, result, 'SUCCESS', '添加文章');
    },
  );
}

function findByPage(req, res, next) {
  let { pageNo, pageSize, manageId, title, tag, isDraft, code } = req.huasenParams;
  let params = { title: { $regex: new RegExp(title, 'i') } };
  if (tag) {
    params.tag = { $regex: new RegExp(tag, 'i') };
  }
  if (manageId) {
    params.manageId = { $regex: new RegExp(manageId, 'i') };
  }
  if (typeof isDraft === 'boolean') {
    params.isDraft = isDraft;
  }
  if (code !== '' && code !== undefined && code !== null) {
    params.code = code;
  }
  req.epWorking(
    [
      {
        schemaName: 'Article',
        methodName: 'findByPage',
        payloads: [
          {
            $and: [params],
          },
          pageNo,
          pageSize,
          {
            content: 0,
          },
        ],
        self: true,
      },
    ],
    result => {
      global.huasen.responseData(res, result, 'SUCCESS', '分页查询文章');
    },
  );
}

function findAllByList(req, res, next) {
  req.epWorking(
    [
      {
        schemaName: 'Article',
        methodName: 'find',
        payloads: [],
      },
    ],
    result => {
      global.huasen.responseData(res, result, 'SUCCESS', '查询文章');
    },
  );
}

function findById(req, res, next) {
  let { proof } = req.huasenJWT;
  let { _id } = req.huasenParams;
  req.epWorking(
    [
      {
        schemaName: 'Article',
        methodName: 'find',
        payloads: [
          {
            // 筛选
            _id,
            // 筛选出小于等于用户权限的文章
            code: { $lte: proof.code },
          },
        ],
      },
      {
        schemaName: 'Article',
        methodName: 'upPV',
        payloads: [_id],
        self: true,
      },
    ],
    result => {
      global.huasen.responseData(res, result, 'SUCCESS', '查询文章');
    },
  );
}

function remove(req, res, next) {
  let { _id } = req.huasenParams;
  req.epWorking(
    [
      {
        schemaName: 'Article',
        methodName: 'deleteOne',
        payloads: [
          {
            _id,
          },
        ],
      },
    ],
    result => {
      global.huasen.responseData(res, result, 'SUCCESS', '删除文章');
    },
  );
}

function update(req, res, next) {
  let { _id } = req.huasenParams;
  req.epWorking(
    [
      {
        schemaName: 'Article',
        methodName: 'updateOne',
        payloads: [{ _id }, { $set: req.huasenParams }, { runValidators: true }],
      },
    ],
    result => {
      global.huasen.responseData(res, result, 'SUCCESS', '更新文章');
    },
  );
}

// $gt:大于
// $lt:小于
// $gte:大于或等于
// $lte:小于或等于
function findByCode(req, res, next) {
  let { proof } = req.huasenJWT;
  req.epWorking(
    [
      {
        schemaName: 'Article',
        methodName: 'find',
        payloads: [
          {
            // 筛选出小于等于用户权限的文章
            code: { $lte: proof.code },
            // 不是草稿
            isDraft: false,
          },
          {
            content: 0,
          },
        ],
      },
    ],
    articles => {
      global.huasen.responseData(res, articles, 'SUCCESS', '查询文章');
    },
  );
}

module.exports = {
  add,
  findByPage,
  findAllByList,
  remove,
  findById,
  update,
  findByCode,
};
