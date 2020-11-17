import { IFFChunk } from './IFFChunks';
import BZZDecoder from '../bzz/BZZDecoder';

/**
 * @typedef {Object} Bookmark
 * @property {string} description
 * @property {string} url
 * @property {Array<Bookmark>} [children]
 */

/** @typedef {Array<Bookmark>} Contents */

/**
 * Оглавление человеко-читаемое
 */
export default class NAVMChunk extends IFFChunk {
    constructor(bs) {
        super(bs);
        this.isDecoded = false;
        this.contents = [];
        this.decodedBookmarkCounter = 0;
    }

    /**
     * @returns {Contents}
     */
    getContents() {
        this.decode();
        return this.contents;
    }

    decode() {
        if (this.isDecoded) {
            return;
        }
        var dbs = BZZDecoder.decodeByteStream(this.bs);
        var bookmarksCount = dbs.getUint16();
        while (this.decodedBookmarkCounter < bookmarksCount) {
            this.contents.push(this.decodeBookmark(dbs));
        }
        this.isDecoded = true;
    }

    /** 
     * @param {import('../ByteStream').ByteStream} bs
     * @returns {Bookmark}
     */
    decodeBookmark(bs) {
        var childrenCount = bs.getUint8();
        var descriptionLength = bs.getInt24();
        var description = descriptionLength ? bs.readStrUTF(descriptionLength) : '';
        var urlLength = bs.getInt24();
        var url = urlLength ? bs.readStrUTF(urlLength) : '';
        this.decodedBookmarkCounter++;

        var bookmark = { description, url };
        if (childrenCount) {
            var children = new Array(childrenCount);
            for (var i = 0; i < childrenCount; i++) {
                children[i] = this.decodeBookmark(bs);
            }
            bookmark.children = children;
        }

        return bookmark;
    }

    toString() {
        this.decode();
        var indent = '    ';

        function stringifyBookmark(bookmark, indentSize = 0) {
            var str = indent.repeat(indentSize) + `${bookmark.description} (${bookmark.url})\n`;
            if (bookmark.children) {
                str = bookmark.children.reduce((str, bookmark) => str + stringifyBookmark(bookmark, indentSize + 1), str);
            }
            return str;
        }

        var str = this.contents.reduce((str, bookmark) => str + stringifyBookmark(bookmark), super.toString());
        return str + '\n';
    }
}