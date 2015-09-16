/*!
 * nodeclub - controllers/order.js
 */

/**
 * Module dependencies.
 */

var validator = require('validator');

var at           = require('../common/at');
var User         = require('../proxy').User;
// var Topic        = require('../proxy').Topic;
// var TopicCollect = require('../proxy').TopicCollect;
var Order        = require('../proxy').Order;
var EventProxy   = require('eventproxy');
var tools        = require('../common/tools');
var store        = require('../common/store');
var config       = require('../config');
var _            = require('lodash');
var cache        = require('../common/cache');

//生成新订单
exports.create = function (req, res, next) {
  res.render('order/edit', {
    tabs: config.tabs,
    grades: config.grades,
  });
};

//保存新订单
exports.put = function (req, res, next) {
  var title   = validator.trim(req.body.title);
  title       = validator.escape(title);
  var tab     = validator.trim(req.body.tab);
  tab         = validator.escape(tab);
  var tabgrade     = validator.trim(req.body.tabgrade);
  tabgrade         = validator.escape(tabgrade);
  var content = validator.trim(req.body.t_content);

  // 得到所有的 tab, e.g. ['ask', 'share', ..]
  var allTabs = config.tabs.map(function (tPair) {
    return tPair[0];
  });

  // 验证
  var editError;
  if (title === '') {
    editError = '标题不能是空的。';
  } else if (title.length < 5 || title.length > 100) {
    editError = '标题字数太多或太少。';
  } else if (!tab || allTabs.indexOf(tab) === -1) {
    editError = '必须选择一个版块。';
  } else if (content === '') {
    editError = '内容不可为空';
  }
  // END 验证

  if (editError) {
    res.status(422);
    return res.render('order/edit', {
      edit_error: editError,
      title: title,
      content: content,
      tabs: config.tabs
    });
  }

  Order.newAndSave(title, content, tab, req.session.user._id, function (err, order) {
    if (err) {
      return next(err);
    }

    var proxy = new EventProxy();

    proxy.all('score_saved', function () {
      res.redirect('/order/' + order._id);
    });
    proxy.fail(next);
    User.getUserById(req.session.user._id, proxy.done(function (user) {
      user.score += 5;
      user.order_count += 1;
      user.save();
      req.session.user = user;
      proxy.emit('score_saved');
    }));

    //发送at消息
    at.sendMessageToMentionUsers(content, order._id, req.session.user._id);
  });
};

/**
 * 显示订单页面
 *
 * @param  {HttpRequest} req
 * @param  {HttpResponse} res
 * @param  {Function} next
 */
exports.index = function (req, res, next) {
  function isUped(user, reply) {
    if (!reply.ups) {
      return false;
    }
    return reply.ups.indexOf(user._id) !== -1;
  }

  var order_id = req.params.oid;
  if (order_id.length !== 24) {
    return res.render404('此订单不存在或已被删除。');
  }
  var events = ['order', 'other_orders', 'no_reply_orders'];
  //var events = ['order'];
  var ep = EventProxy.create(events, function (order) {
    res.render('order/index', {
      order: order,
      is_uped: isUped
    });
  });

  ep.fail(next);

  Order.getFullOrder(order_id, ep.done(function (message, order, author, replies) {
    if (message) {
      ep.unbind();
      return res.renderError(message);
    }

    order.visit_count += 1;
    order.save();

    order.author  = author;
    order.replies = replies;

 

    ep.emit('order', order);

    // get other_orders
    var options = { limit: 5, sort: '-last_reply_at'};
    var query = { author_id: order.author_id, _id: { '$nin': [ order._id ] } };
    Order.getOrdersByQuery(query, options, ep.done('other_orders'));

    // get no_reply_orders
    cache.get('no_reply_orders', ep.done(function (no_reply_orders) {
      if (no_reply_orders) {
        ep.emit('no_reply_orders', no_reply_orders);
      } else {
        Order.getOrdersByQuery(
          { reply_count: 0, tab: {$ne: 'job'}},
          { limit: 5, sort: '-create_at'},
          ep.done('no_reply_orders', function (no_reply_showEdit,
            orders) {
            cache.set('no_reply_orders', no_reply_orders, 60 * 1);
            return no_reply_orders;
          }));
      }
    }));
  }));
};





exports.showEdit = function (req, res, next) {
  var order_id = req.params.tid;

  Order.getOrderById(order_id, function (err, order, tags) {
    if (!order) {
      res.render404('此话题不存在或已被删除。');
      return;
    }

    if (String(order.author_id) === String(req.session.user._id) || req.session.user.is_admin) {
      res.render('order/edit', {
        action: 'edit',
        order_id: order._id,
        title: order.title,
        content: order.content,
        tab: order.tab,
        tabs: config.tabs
      });
    } else {
      res.renderError('对不起，你不能编辑此话题。', 403);
    }
  });
};

exports.update = function (req, res, next) {
  var order_id = req.params.tid;
  var title    = req.body.title;
  var tab      = req.body.tab;
  var content  = req.body.t_content;

  Order.getOrderById(order_id, function (err, order, tags) {
    if (!order) {
      res.render404('此话题不存在或已被删除。');
      return;
    }

    if (order.author_id.equals(req.session.user._id) || req.session.user.is_admin) {
      title   = validator.trim(title);
      title   = validator.escape(title);
      tab     = validator.trim(tab);
      tab     = validator.escape(tab);
      content = validator.trim(content);

      // 验证
      var editError;
      if (title === '') {
        editError = '标题不能是空的。';
      } else if (title.length < 5 || title.length > 100) {
        editError = '标题字数太多或太少。';
      } else if (!tab) {
        editError = '必须选择一个版块。';
      }
      // END 验证

      if (editError) {
        return res.render('order/edit', {
          action: 'edit',
          edit_error: editError,
          order_id: order._id,
          content: content,
          tabs: config.tabs
        });
      }

      //保存话题
      order.title     = title;
      order.content   = content;
      order.tab       = tab;
      order.update_at = new Date();

      order.save(function (err) {
        if (err) {
          return next(err);
        }
        //发送at消息
        at.sendMessageToMentionUsers(content, order._id, req.session.user._id);

        res.redirect('/order/' + order._id);

      });
    } else {
      res.renderError('对不起，你不能编辑此话题。', 403);
    }
  });
};

exports.delete = function (req, res, next) {
  //删除话题, 话题作者order_count减1
  //删除回复，回复作者reply_count减1
  //删除order_collect，用户collect_order_count减1

  var order_id = req.params.tid;

  Order.getOrder(order_id, function (err, order) {
    if (err) {
      return res.send({ success: false, message: err.message });
    }
    if (!req.session.user.is_admin && !(order.author_id.equals(req.session.user._id))) {
      res.status(403);
      return res.send({success: false, message: '无权限'});
    }
    if (!order) {
      res.status(422);
      return res.send({ success: false, message: '此话题不存在或已被删除。' });
    }
    order.deleted = true;
    order.save(function (err) {
      if (err) {
        return res.send({ success: false, message: err.message });
      }
      res.send({ success: true, message: '话题已被删除。' });
    });
  });
};

// 设为置顶
exports.top = function (req, res, next) {
  var order_id = req.params.tid;
  var referer  = req.get('referer');

  if (order_id.length !== 24) {
    res.render404('此话题不存在或已被删除。');
    return;
  }
  Order.getOopic(order_id, function (err, order) {
    if (err) {
      return next(err);
    }
    if (!order) {
      res.render404('此话题不存在或已被删除。');
      return;
    }
    order.top = !order.top;
    order.save(function (err) {
      if (err) {
        return next(err);
      }
      var msg = order.top ? '此话题已置顶。' : '此话题已取消置顶。';
      res.render('notify/notify', {success: msg, referer: referer});
    });
  });
};

// 设为精华
exports.good = function (req, res, next) {
  var orderId = req.params.tid;
  var referer = req.get('referer');

  Order.getOrder(orderId, function (err, order) {
    if (err) {
      return next(err);
    }
    if (!order) {
      res.render404('此话题不存在或已被删除。');
      return;
    }
    order.good = !order.good;
    order.save(function (err) {
      if (err) {
        return next(err);
      }
      var msg = order.good ? '此话题已加精。' : '此话题已取消加精。';
      res.render('notify/notify', {success: msg, referer: referer});
    });
  });
};

// 锁定主题，不可再回复
exports.lock = function (req, res, next) {
  var orderId = req.params.tid;
  var referer = req.get('referer');
  Order.getOrder(orderId, function (err, order) {
    if (err) {
      return next(err);
    }
    if (!order) {
      res.render404('此话题不存在或已被删除。');
      return;
    }
    order.lock = !order.lock;
    order.save(function (err) {
      if (err) {
        return next(err);
      }
      var msg = order.lock ? '此话题已锁定。' : '此话题已取消锁定。';
      res.render('notify/notify', {success: msg, referer: referer});
    });
  });
};

// 收藏主题
exports.collect = function (req, res, next) {
  var order_id = req.body.order_id;
  Order.getOrder(order_id, function (err, order) {
    if (err) {
      return next(err);
    }
    if (!order) {
      res.json({status: 'failed'});
    }

    TopicCollect.getTopicCollect(req.session.user._id, topic._id, function (err, doc) {
      if (err) {
        return next(err);
      }
      if (doc) {
        res.json({status: 'success'});
        return;
      }

      TopicCollect.newAndSave(req.session.user._id, topic._id, function (err) {
        if (err) {
          return next(err);
        }
        res.json({status: 'success'});
      });
      User.getUserById(req.session.user._id, function (err, user) {
        if (err) {
          return next(err);
        }
        user.collect_topic_count += 1;
        user.save();
      });

      req.session.user.collect_topic_count += 1;
      topic.collect_count += 1;
      topic.save();
    });
  });
};

exports.de_collect = function (req, res, next) {
  var topic_id = req.body.topic_id;
  Topic.getTopic(topic_id, function (err, topic) {
    if (err) {
      return next(err);
    }
    if (!topic) {
      res.json({status: 'failed'});
    }
    TopicCollect.remove(req.session.user._id, topic._id, function (err) {
      if (err) {
        return next(err);
      }
      res.json({status: 'success'});
    });

    User.getUserById(req.session.user._id, function (err, user) {
      if (err) {
        return next(err);
      }
      user.collect_topic_count -= 1;
      user.save();
    });

    topic.collect_count -= 1;
    topic.save();

    req.session.user.collect_topic_count -= 1;
  });
};

exports.upload = function (req, res, next) {
  req.busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
      store.upload(file, {filename: filename}, function (err, result) {
        if (err) {
          return next(err);
        }
        res.json({
          success: true,
          url: result.url,
        });
      });
    });

  req.pipe(req.busboy);
};
