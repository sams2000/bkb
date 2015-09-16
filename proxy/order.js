var EventProxy = require('eventproxy');
var models     = require('../models');
//var Topic      = models.Topic;
var Order      = models.Order;
var User       = require('./user');
var Reply      = require('./reply');
var tools      = require('../common/tools');
var at         = require('../common/at');
var _          = require('lodash');


/**
 * 根据关键词，获取主题列表
 * Callback:
 * - err, 数据库错误
 * - count, 主题列表
 * @param {String} query 搜索关键词
 * @param {Object} opt 搜索选项
 * @param {Function} callback 回调函数
 */
exports.getOrdersByQuery = function (query, opt, callback) {
  query.deleted = false;
  Order.find(query, {}, opt, function (err, orders) {
    if (err) {
      return callback(err);
    }
    if (orders.length === 0) {
      return callback(null, []);
    }

    var proxy = new EventProxy();
    proxy.after('order_ready', orders.length, function () {
      orders = _.compact(orders); // 删除不合规的 order
      return callback(null, orders);
    });
    proxy.fail(callback);

    orders.forEach(function (order, i) {
      var ep = new EventProxy();
      ep.all('author', 'reply', function (author, reply) {
        // 保证顺序
        // 作者可能已被删除
        if (author) {
          order.author = author;
          order.reply = reply;
        } else {
          orders[i] = null;
        }
        proxy.emit('order_ready');
      });

      User.getUserById(order.author_id, ep.done('author'));
      // 获取主题的最后回复
      Reply.getReplyById(order.last_reply, ep.done('reply'));
    });
  });
};

exports.newAndSave = function (title, content, tab, authorId, callback) {
  var order       = new Order();
  order.title     = title;
  order.content   = content;
  order.tab       = tab;
  order.author_id = authorId;

  order.save(callback);
};








/**
 * 根据主题ID获取主题
 * Callback:
 * - err, 数据库错误
 * - order, 主题
 * - author, 作者
 * - lastReply, 最后回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getOrderById = function (id, callback) {
  var proxy = new EventProxy();
  var events = ['order', 'author', 'last_reply'];
  proxy.assign(events, function (order, author, last_reply) {
    if (!author) {
      return callback(null, null, null, null);
    }
    return callback(null, order, author, last_reply);
  }).fail(callback);

  Order.findOne({_id: id}, proxy.done(function (order) {
    if (!order) {
      proxy.emit('order', null);
      proxy.emit('author', null);
      proxy.emit('last_reply', null);
      return;
    }
    proxy.emit('order', order);

    User.getUserById(order.author_id, proxy.done('author'));

    if (order.last_reply) {
      Reply.getReplyById(order.last_reply, proxy.done(function (last_reply) {
        proxy.emit('last_reply', last_reply);
      }));
    } else {
      proxy.emit('last_reply', null);
    }
  }));
};

/**
 * 获取关键词能搜索到的主题数量
 * Callback:
 * - err, 数据库错误
 * - count, 主题数量
 * @param {String} query 搜索关键词
 * @param {Function} callback 回调函数
 */
exports.getCountByQuery = function (query, callback) {
  Order.count(query, callback);
};



// for sitemap
exports.getLimit5w = function (callback) {
  Order.find({deleted: false}, '_id', {limit: 50000, sort: '-create_at'}, callback);
};

/**
 * 获取所有信息的主题
 * Callback:
 * - err, 数据库异常
 * - message, 消息
 * - order, 主题
 * - author, 主题作者
 * - replies, 主题的回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getFullOrder = function (id, callback) {
  var proxy = new EventProxy();
  //var events = ['order', 'author', 'replies'];
  var events = ['order', 'author'];
  // proxy
  //   .assign(events, function (order, author, replies) {
  //     callback(null, '', order, author, replies);
  //   })
  //   .fail(callback);

  proxy
    .assign(events, function (order, author) {
      callback(null, '', order, author);
    })
    .fail(callback);


  Order.findOne({_id: id}, proxy.done(function (order) {
    if (!order) {
      proxy.unbind();
      return callback(null, '此话题不存在或已被删除。');
    }
    at.linkUsers(order.content, proxy.done('order', function (str) {
      order.linkedContent = str;
      return order;
    }));

    User.getUserById(order.author_id, proxy.done(function (author) {
      if (!author) {
        proxy.unbind();
        return callback(null, '话题的作者丢了。');
      }
      proxy.emit('author', author);
    }));

    //Reply.getRepliesByOrderId(order._id, proxy.done('replies'));
  }));
};

/**
 * 更新主题的最后回复信息
 * @param {String} orderId 主题ID
 * @param {String} replyId 回复ID
 * @param {Function} callback 回调函数
 */
exports.updateLastReply = function (orderId, replyId, callback) {
  Order.findOne({_id: orderId}, function (err, order) {
    if (err || !order) {
      return callback(err);
    }
    order.last_reply    = replyId;
    order.last_reply_at = new Date();
    order.reply_count += 1;
    order.save(callback);
  });
};

/**
 * 根据主题ID，查找一条主题
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getOrder = function (id, callback) {
  Order.findOne({_id: id}, callback);
};

/**
 * 将当前主题的回复计数减1，并且更新最后回复的用户，删除回复时用到
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.reduceCount = function (id, callback) {
  Order.findOne({_id: id}, function (err, order) {
    if (err) {
      return callback(err);
    }

    if (!order) {
      return callback(new Error('该主题不存在'));
    }
    order.reply_count -= 1;

    Reply.getLastReplyByTopId(id, function (err, reply) {
      if (err) {
        return callback(err);
      }

      if (reply.length !== 0) {
        order.last_reply = reply[0]._id;
      } else {
        order.last_reply = null;
      }

      order.save(callback);
    });

  });
};


