var path = require('path'),
    util = require('util'),
    fs = require('fs'),
    crypto = require('crypto'),
    bencode = require('bencode'),
    CombinedStream = require('combined-stream'),
    Transform = require('stream').Transform,

    VERSION = "0.0.1",
    PIECE_SIZE = 524288; // 512KB

util.inherits(Chunker, Transform);

function Chunker(opts) {
    if (!(this instanceof Chunker))
        return new Chunker(opts);

    Transform.call(this, opts);

    this._maxSize = opts.size;

    this._chunks = [];
    this._size = 0;
}

Chunker.prototype._transform = function(chunk, encoding, done) {
    var available;

    if (this._size + chunk.length > this._maxSize) {
        available = this._maxSize - this._size;

        this._chunks.push(chunk.slice(0, available));
        this.push(Buffer.concat(this._chunks));

        this._size = 0;
        this._chunks = [];
        return this._transform(chunk.slice(available, chunk.length), 
                               encoding, done); 
    }

    this._chunks.push(chunk);
    this._size += chunk.length;
    done();
}

Chunker.prototype._flush = function(callback) {
    this.push(Buffer.concat(this._chunks));
    this._size = 0;
    this._chunks = [];
    callback();
};

function generate(files, announceList, opts, callback) {
    var opts = opts || {},
        dict = {},
        filesStream = CombinedStream.create(),
        chunker = new Chunker({ size: PIECE_SIZE }),
        ended = false,
        pieces = new Buffer(""),
        buf, hash,
        i = 0;

    if (!Array.isArray(announceList)) {
        announceList = [announceList];
    }

    dict.announce = announceList.shift();

    if (announceList.length) {
        dict['announce-list'] = [announceList];
    }

    dict['created by'] = "node-mktorrent v" + VERSION;
    dict['creation date'] = +new Date / 1000 | 0;
    // XXX: I don't think encoding is needed
    //dict['encoding'] = 'UTF-8';

    if (!Array.isArray(files)) {
        files = [files];
    }

    files.forEach(function(file) {
        filesStream.append(fs.createReadStream(file));
    });

    chunker.on('start', function() {
        console.log("begin");
    });

    chunker.on('end', function() {
        console.log("end");
        dict.info = {
            'piece length': PIECE_SIZE,
            pieces: pieces
        };

        if (files.length == 1) {
            dict.info.length = fs.readFileSync(files[0]).length,
            dict.info.name = path.basename(files[0])
        } else {
            if (opts.name)
                dict.info.name = opts.name;
            dict.info.files = [];

            files.forEach(function(file) {
                dict.info.files.push({
                    length: fs.readFileSync(file).length,
                    path: file.split(path.sep)
                });
            });
        }

        callback(bencode.encode(dict));
    });

    chunker.on('data', function(chunk) {
        hash = crypto.createHash('sha1');
        hash.update(chunk);

        var digest = hash.digest();
        console.log(digest.length);
        pieces = Buffer.concat([pieces, digest]);
    });

    filesStream.pipe(chunker);
}

exports.generate = generate;
