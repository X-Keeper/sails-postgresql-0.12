var should = require('should');
var pg = require('pg');
var support = require('./support/bootstrap');

describe('unit test support client', function() {

  it('opens and closes a client without the removed pg.connect helper', function(done) {
    var OriginalClient = pg.Client;
    var callbackArgs;
    var ended = false;

    function FakeClient(config) {
      this.config = config;
    }

    FakeClient.prototype.connect = function(cb) {
      cb();
    };

    FakeClient.prototype.end = function(cb) {
      ended = true;
      if(cb) {
        cb();
      }
    };

    pg.Client = FakeClient;

    try {
      (function() {
        support.Client(function() {
          callbackArgs = arguments;
        });
      }).should.not.throw();

      should.not.exist(callbackArgs[0]);
      callbackArgs[1].should.be.an.instanceof(FakeClient);
      callbackArgs[2]();
      ended.should.equal(true);
      done();
    } catch (e) {
      done(e);
    } finally {
      pg.Client = OriginalClient;
    }
  });

});
