Lawnchair.adapter('webkit-sqlite', (function () {
    // private methods 
    var fail = function (e, i) {
        console.error('error in sqlite adaptor!', e, i)
    }, now = function () {
            return new Date()
        } // FIXME need to use better date fn
        // not entirely sure if this is needed...
    if (!Function.prototype.bind) {
        Function.prototype.bind = function (obj) {
            var slice = [].slice,
                args = slice.call(arguments, 1),
                self = this,
                nop = function () {}, bound = function () {
                    return self.apply(this instanceof nop ? this : (obj || {}), args.concat(slice.call(arguments)))
                }
            nop.prototype = self.prototype
            bound.prototype = new nop()
            return bound
        }
    }

    var typeMap = {
        "number": "INTEGER",
        "string": "TEXT",
        "boolean": "BOOLEAN",
        "char" : "NVARCHAR",
        "real" : "REAL",
        "datetime": "TEXT",
        "date": "TEXT",
        "object": "TEXT"
    };

    function createColDefn(col) {
        if (col.type && !(col.type in typeMap)){
            throw new Error("Unsupported type: " + col.type);
        }

        var defn = "`" + col.name + "`";

        if (col.type) {
            defn += " " + typeMap[col.type];
        }

        if (col.max){
            defn += ' (' + col.max + ')';
        }

        if (col.unique) {
            defn += ' UNIQUE';
        }

        if (col.primary){
            defn += ' PRIMARY KEY';
        }

        return defn;
    };

    // public methods
    return {

        valid: function () {
            return !!(window.openDatabase)
        },

        init: function (options, callback) {

            if (! options.columns){
                options.columns = [];
            }

            options.columns.push({
                'name': 'id',
                'type': 'char', 
                'max': 32,
                'primary': true,
                'unique': true
            });

            options.columns.push({
                'name': 'lawnchairtimestamp',
                'type': 'real'
            });

            //Save table column names
            this.columns = options.columns.map(function(o){return o.name});

            var colDefns = options.columns.map(createColDefn);

            var that = this,
                cb = that.fn(that.name, callback),
                create = "CREATE TABLE IF NOT EXISTS " + this.record + " ( " + colDefns.join(", ") + ")",
                win = function () {
                    if (cb) return cb.call(that, that);
                }

            if (cb && typeof cb != 'function') throw 'callback not valid';

            // open a connection and create the db if it doesn't exist 
            this.db = openDatabase(this.name, '1.0.0', this.name, 65536)
            this.db.transaction(function (t) {
                t.executeSql(create, [])
            }, fail, win)
        },

        keys: function (callback) {
            var cb = this.lambda(callback),
                that = this,
                keys = "SELECT id FROM " + this.record + " ORDER BY lawnchairtimestamp DESC"

            this.db.readTransaction(function (t) {
                var win = function (xxx, results) {
                    if (results.rows.length == 0) {
                        cb.call(that, [])
                    } else {
                        var r = [];
                        for (var i = 0, l = results.rows.length; i < l; i++) {
                            r.push(results.rows.item(i).id);
                        }
                        cb.call(that, r)
                    }
                }
                t.executeSql(keys, [], win, fail)
            })
            return this
        },
        // you think thats air you're breathing now?
        save: function (obj, callback, error) {

            var that = this,
                objs = (this.isArray(obj) ? obj : [obj]).map(function (o) {
                    if (!o.key) {
                        o.key = that.uuid()
                    }
                    return o
                }),
                ins = [],
                win = function () {
                    if (callback) {
                        that.lambda(callback).call(that, that.isArray(obj) ? objs : objs[0])
                    }
                }, error = error || function () {}, insvals = [],
                ts = now();

            try {
                for (var i = 0, l = objs.length; i < l; i++) {

                    var o = objs[i];
                    var colNames = [];
                    var placeholders = [];
                    var params = [];

                    for (var j = this.columns.length - 1; j >= 0; j--) {

                        var colName = this.columns[j];

                        if (colName == 'id' || colName == 'lawnchairtimestamp'){ //Skip this values, we set them later
                            continue;
                        }

                        colNames.push("`" + colName + "`");
                        placeholders.push('?');
                        params.push(o[colName]);   
                    };

                    //Set `id`
                    colNames.push("`id`");
                    placeholders.push('?');
                    params.push(o.key);

                    //Set `lawnchairtimestamp`
                    colNames.push("`lawnchairtimestamp`");
                    placeholders.push('?');
                    params.push(ts);

                    ins[i] = "INSERT OR REPLACE INTO " + this.record + " (" + colNames.join(",") + ") VALUES (" + placeholders.join(",") + ")";
                    insvals[i] = params;
                }
            } catch (e) {
                fail(e)
                throw e;
            }

            that.db.transaction(function (t) {
                for (var i = 0, l = objs.length; i < l; i++)
                    t.executeSql(ins[i], insvals[i])
            }, function (e, i) {
                fail(e, i)
            }, win)

            return this
        },


        batch: function (objs, callback) {
            return this.save(objs, callback)
        },

        get: function (keyOrArray, cb) {
            var that = this,
                sql = '',
                args = this.isArray(keyOrArray) ? keyOrArray : [keyOrArray];
            // batch selects support
            sql = 'SELECT ' + this.columns.join(", ") + ' FROM ' + this.record + " WHERE id IN (" +
                args.map(function () {
                    return '?'
                }).join(",") + ")"
            // FIXME
            // will always loop the results but cleans it up if not a batch return at the end..
            // in other words, this could be faster
            var win = function (xxx, results) {
                var r, lookup = {}
                    // map from results to keys
                for (var i = 0, l = results.rows.length; i < l; i++) {
                    var o = {};
                    for (var property in results.rows.item(i)) {
                        if (results.rows.item(i).hasOwnProperty(property)) {
                            o[property] = (results.rows.item(i))[property];
                        }
                    }

                    delete o.id;
                    delete o.lawnchairtimestamp;
                    
                    o.key = results.rows.item(i).id;
                    lookup[o.key] = o;
                }
                r = args.map(function (key) {
                    return lookup[key];
                });
                if (!that.isArray(keyOrArray)) r = r.length ? r[0] : null
                if (cb) that.lambda(cb).call(that, r)
            }
            this.db.readTransaction(function (t) {
                t.executeSql(sql, args, win, fail)
            })
            return this
        },

        exists: function (key, cb) {
            var is = "SELECT * FROM " + this.record + " WHERE id = ?",
                that = this,
                win = function (xxx, results) {
                    if (cb) that.fn('exists', cb).call(that, (results.rows.length > 0))
                }
            this.db.readTransaction(function (t) {
                t.executeSql(is, [key], win, fail)
            })
            return this
        },

        all: function (callback, options) {

            var where = '';
            var params = [];

            if (options && options.filters){
                if ( typeof options.filters == 'string') {
                    where += ' WHERE ' + options.filters;
                } else if ( typeof options.filters == 'object') {
                    where += ' WHERE ' + Object.keys(options.filters).map(function(col) {
                                                        params.push(options.filters[col]);
                                                        return '`' + col + '` = ?';
                                                }).join(' AND ');
                } 
            }

            var that = this,
                all = "SELECT * FROM " + this.record + where,
                r = [],
                cb = this.fn(this.name, callback) || undefined,
                win = function (xxx, results) {
                    if (results.rows.length != 0) {
                        for (var i = 0, l = results.rows.length; i < l; i++) {
                            var obj = {};

                            for (var property in results.rows.item(i)) {
                                if (results.rows.item(i).hasOwnProperty(property)) {
                                    obj[property] = (results.rows.item(i))[property];
                                }
                            }

                            delete obj.id;
                            delete obj.lawnchairtimestamp;

                            obj.key = results.rows.item(i).id;
                            r.push(obj);
                        }
                    }
                    if (cb) cb.call(that, r)
                }

            this.db.readTransaction(function (t) {
                t.executeSql(all, params, win, fail)
            })
            return this
        },

        remove: function (keyOrArray, cb) {
            var that = this,
                args, sql = "DELETE FROM " + this.record + " WHERE id ",
                win = function () {
                    if (cb) that.lambda(cb).call(that)
                }
            if (!this.isArray(keyOrArray)) {
                sql += '= ?';
                args = [keyOrArray];
            } else {
                args = keyOrArray;
                sql += "IN (" +
                    args.map(function () {
                        return '?'
                    }).join(',') +
                    ")";
            }
            args = args.map(function (obj) {
                return obj.key ? obj.key : obj;
            });

            this.db.transaction(function (t) {
                t.executeSql(sql, args, win, fail);
            });

            return this;
        },

        nuke: function (cb) {
            var nuke = "DELETE FROM " + this.record,
                that = this,
                win = cb ? function () {
                    that.lambda(cb).call(that)
                } : function () {}
            this.db.transaction(function (t) {
                t.executeSql(nuke, [], win, fail)
            })
            return this
        }
        //////
    }
})());
