var multiline = require('multiline');
// static page
// About
exports.about = function (req, res, next) {
  res.render('static/about', {
    pageTitle: '关于我们'
  });
};

exports.contact = function (req, res, next) {
  res.render('static/contact', {
    pageTitle: '联系我们'
  });
};

exports.jobs = function (req, res, next) {
  res.render('static/jobs', {
    pageTitle: '诚聘英才'
  });
};

// FAQ
exports.faq = function (req, res, next) {
  res.render('static/faq');
};

exports.api = function (req, res, next) {
  res.render('static/api');
};
