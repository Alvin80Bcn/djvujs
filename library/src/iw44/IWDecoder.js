import IWCodecBaseClass from './IWCodecBaseClass';
import { LinearBytemap, Block, LazyBlock } from './IWStructures';
import DjVu from '../DjVu';

export default class IWDecoder extends IWCodecBaseClass {

    constructor() {
        super();
    }

    init(imageinfo) {
        // инициализируем на первой порции данных
        this.info = imageinfo;
        var blockCount = Math.ceil(this.info.width / 32) * Math.ceil(this.info.height / 32);
        this.blocks = LazyBlock.createBlockArray(blockCount);
    }

    decodeSlice(zp, imageinfo) {
        if (!this.info) {
            this.init(imageinfo);
        }

        this.zp = zp;
        if (!this.is_null_slice()) {
            // по блокам идем            
            this.blocks.forEach(block => {
                this.preliminaryFlagComputation(block);
                // четыре подхода декодирования
                if (this.blockBandDecodingPass()) {
                    this.bucketDecodingPass(block, this.curband);
                    this.newlyActiveCoefficientDecodingPass(block, this.curband);
                }
                this.previouslyActiveCoefficientDecodingPass(block);
            });
        }
        // уменьшаем шаги 
        this.finish_code_slice();
    }

    previouslyActiveCoefficientDecodingPass(block) {
        var boff = 0;
        var step = this.quant_hi[this.curband];
        var indices = this.getBandBuckets(this.curband);
        for (var i = indices.from; i <= indices.to; i++, boff++) {
            for (var j = 0; j < 16; j++) {
                if (this.coeffstate[boff][j] & 2 /*ACTIVE*/) {
                    if (!this.curband) {
                        step = this.quant_lo[j];
                    }
                    var des = 0;
                    var coef = block.getBucketCoef(i, j);
                    var absCoef = Math.abs(coef);
                    if (absCoef <= 3 * step) {
                        des = this.zp.decode(this.inreaseCoefCtx, 0);
                        absCoef += step >> 2;
                    } else {
                        des = this.zp.IWdecode();
                    }
                    if (des) {
                        absCoef += step >> 1;
                    } else {
                        absCoef += -step + (step >> 1);
                    }
                    block.setBucketCoef(i, j, coef < 0 ? -absCoef : absCoef);
                }
            }
        }
    }

    newlyActiveCoefficientDecodingPass(block, band) {
        //bucket offset
        var boff = 0;
        var indices = this.getBandBuckets(band);
        //проверка на 0 группу позже
        var step = this.quant_hi[this.curband];
        for (var i = indices.from; i <= indices.to; i++, boff++) {
            if (this.bucketstate[boff] & 4/*NEW*/) {
                var shift = 0;
                if (this.bucketstate[boff] & 2/*ACTIVE*/) {
                    shift = 8;
                }
                var np = 0;
                for (var j = 0; j < 16; j++) {
                    if (this.coeffstate[boff][j] & 8/*UNK*/) {
                        np++;
                    }
                }

                for (var j = 0; j < 16; j++) {
                    if (this.coeffstate[boff][j] & 8/*UNK*/) {
                        var ip = Math.min(7, np);
                        var des = this.zp.decode(this.activateCoefCtx, shift + ip);
                        if (des) {
                            var sign = this.zp.IWdecode() ? -1 : 1;
                            np = 0;
                            if (!this.curband) {
                                step = this.quant_lo[j];
                            }
                            //todo сравнить нужно ли 2 слагаемое
                            block.setBucketCoef(i, j, sign * (step + (step >> 1) - (step >> 3)));
                        }
                        if (np) {
                            np--;
                        }
                    }
                }
            }
        }
    }

    bucketDecodingPass(block, band) {
        var indices = this.getBandBuckets(band);
        // смещение сегмента
        var boff = 0;
        for (var i = indices.from; i <= indices.to; i++, boff++) {
            // проверка потенциального флага сегмента         
            if (!(this.bucketstate[boff] & 8/*UNK*/)) {
                continue;
            }
            //вычисляем номер контекста
            var n = 0;
            if (band) {
                var t = 4 * i;
                for (var j = t; j < t + 4; j++) {
                    if (block.getCoef(j)) {
                        n++;
                    }
                }
                if (n === 4) {
                    n--;
                }
            }
            if (this.bbstate & 2/*ACTIVE*/) {
                //как и + 4
                n |= 4;
            }
            if (this.zp.decode(this.decodeCoefCtx, n + band * 8)) {
                this.bucketstate[boff] |= 4/*NEW*/;
            }
        }
    }

    blockBandDecodingPass() {
        var indices = this.getBandBuckets(this.curband);
        var bcount = indices.to - indices.from + 1;
        if (bcount < 16 || (this.bbstate & 2/*ACTIVE*/)) {
            this.bbstate |= 4 /*NEW*/;
        } else if (this.bbstate & 8/*UNK*/) {
            if (this.zp.decode(this.decodeBucketCtx, 0)) {
                this.bbstate |= 4/*NEW*/;
            }
        }
        return this.bbstate & 4/*NEW*/;
    }

    preliminaryFlagComputation(block) {
        this.bbstate = 0;
        var bstatetmp = 0;
        var indices = this.getBandBuckets(this.curband);
        if (this.curband) {
            //смещение сегмента в массиве флагов
            var boff = 0;
            for (var j = indices.from; j <= indices.to; j++, boff++) {
                bstatetmp = 0;
                for (var k = 0; k < 16; k++) {
                    if (block.getBucketCoef(j, k) === 0) {
                        this.coeffstate[boff][k] = 8/*UNK*/;
                    } else {
                        this.coeffstate[boff][k] = 2/*ACTIVE*/;
                    }
                    bstatetmp |= this.coeffstate[boff][k];
                }
                this.bucketstate[boff] = bstatetmp;
                this.bbstate |= bstatetmp;
            }
        } else {
            //если нулевая группа            
            for (var k = 0; k < 16; k++) {
                //если шаг в допустимых пределах
                if (this.coeffstate[0][k] !== 1/*ZERO*/) {
                    if (block.getBucketCoef(0, k) === 0) {
                        this.coeffstate[0][k] = 8/*UNK*/;
                    } else {
                        this.coeffstate[0][k] = 2/*ACTIVE*/;
                    }
                }
                bstatetmp |= this.coeffstate[0][k];
            }
            this.bucketstate[0] = bstatetmp;
            this.bbstate |= bstatetmp;
        }
    }

    getBytemap() {
        var time = performance.now();

        var fullWidth = Math.ceil(this.info.width / 32) * 32;
        var fullHeight = Math.ceil(this.info.height / 32) * 32;
        var blockRows = Math.ceil(this.info.height / 32);
        var blockCols = Math.ceil(this.info.width / 32);

        // (this.blocks[0] instanceof LazyBlock) && console.log('Memory usage ',
        //     this.blocks[0].mm.retainedMemory / 1024 / 1024,
        //     this.blocks[0].mm.usedMemory / 1024 / 1024);

        var bm = new LinearBytemap(fullWidth, fullHeight);
        for (var r = 0; r < blockRows; r++) {
            for (var c = 0; c < blockCols; c++) {
                var block = this.blocks[r * blockCols + c];
                for (var i = 0; i < 1024; i++) {
                    /*var bits = [];
                    for (var j = 0; j < 10; j++) {
                        bits.push((i & Math.pow(2, j)) >> j);
                    }
                    var row = 16 * bits[1] + 8 * bits[3] + 4 * bits[5] + 2 * bits[7] + bits[9];
                    var col = 16 * bits[0] + 8 * bits[2] + 4 * bits[4] + 2 * bits[6] + bits[8];*/
                    // bitmap[this.zigzagRow[i] + 32 * r][this.zigzagCol[i] + 32 * c] = block.getCoef(i);
                    bm.set(this.zigzagRow[i] + (r << 5), this.zigzagCol[i] + (c << 5), block.getCoef(i));
                }
            }
        }

        DjVu.IS_DEBUG && console.time("inverseTime");
        this.inverseWaveletTransform(bm);
        DjVu.IS_DEBUG && console.timeEnd("inverseTime");

        DjVu.IS_DEBUG && console.log("getBytemap time = ", performance.now() - time);

        return bm;
    }

    /**
     * Алгоритм для строк и для столбцов по сути один и тот же. Разница в том,
     * что индексы переставлены местами.
     * 
     * The variant when the algorithm is extracted as a separate function 
     * and used both for columns with the bytemap object and for rows via a shim object 
     * (which swaps i and j in all methods' of the Bytemap, even 
     * an optimized version working with the inner array directly)
     * works slower than the current variant. 
     */
    inverseWaveletTransform(bitmap) {
        var height = this.info.height;
        var width = this.info.width;
        var a, c, kmax, k, i, border;
        var prev3, prev1, next1, next3;

        for (var s = 16, sDegree = 4; s !== 0; s >>= 1, sDegree--) { // 2^4 === 16
            //для столбцов
            kmax = (height - 1) >> sDegree;
            border = kmax - 3;
            for (i = 0; i < width; i += s) {
                //Lifting

                k = 0;
                prev1 = 0; next1 = 0;
                next3 = 1 > kmax ? 0 : bitmap.get(1 << sDegree, i);

                for (k = 0; k <= kmax; k += 2) {
                    prev3 = prev1; prev1 = next1; next1 = next3;
                    next3 = (k + 3) > kmax ? 0 : bitmap.get((k + 3) << sDegree, i);

                    a = prev1 + next1;
                    c = prev3 + next3;
                    bitmap.sub(k << sDegree, i, ((a << 3) + a - c + 16) >> 5);
                }

                //Prediction 

                k = 1;
                prev1 = bitmap.get((k - 1) << sDegree, i);
                if (k + 1 <= kmax) {
                    next1 = bitmap.get((k + 1) << sDegree, i);
                    bitmap.add(k << sDegree, i, (prev1 + next1 + 1) >> 1);
                } else {
                    bitmap.add(k << sDegree, i, prev1);
                }

                if (border >= 3) {
                    next3 = bitmap.get((k + 3) << sDegree, i);
                }

                for (k = 3; k <= border; k += 2) {
                    prev3 = prev1; prev1 = next1; next1 = next3;
                    next3 = bitmap.get((k + 3) << sDegree, i);

                    a = prev1 + next1;
                    bitmap.add(k << sDegree, i,
                        ((a << 3) + a - (prev3 + next3) + 8) >> 4
                    );
                }

                for (; k <= kmax; k += 2) {
                    prev1 = next1; next1 = next3; next3 = 0;
                    if (k + 1 <= kmax) {
                        bitmap.add(k << sDegree, i, (prev1 + next1 + 1) >> 1);
                    } else {
                        bitmap.add(k << sDegree, i, prev1);
                    }
                }
            }

            //для строк
            kmax = (width - 1) >> sDegree;
            border = kmax - 3;

            for (i = 0; i < height; i += s) {

                //Lifting
                k = 0;
                prev1 = 0;
                next1 = 0;
                next3 = 1 > kmax ? 0 : bitmap.get(i, 1 << sDegree);

                for (k = 0; k <= kmax; k += 2) {
                    prev3 = prev1; prev1 = next1; next1 = next3;
                    next3 = k + 3 > kmax ? 0 : bitmap.get(i, (k + 3) << sDegree);

                    a = prev1 + next1;
                    c = prev3 + next3;
                    bitmap.sub(i, k << sDegree, ((a << 3) + a - c + 16) >> 5);
                }

                // Выполняется медленнее с этой оптимизацией.

                // for (; k <= kmax; k += 2) {
                //     prev3 = prev1; prev1 = next1; next1 = next3; next3 = 0;

                //     a = prev1 + next1;
                //     c = prev3 + next3;
                //     bitmap.sub(i, k << sDegree, ((a << 3) + a - c + 16) >> 5);
                // }

                //Prediction

                k = 1
                prev1 = bitmap.get(i, (k - 1) << sDegree);
                if (k + 1 <= kmax) {
                    next1 = bitmap.get(i, (k + 1) << sDegree);
                    bitmap.add(i, k << sDegree, (prev1 + next1 + 1) >> 1);
                } else {
                    bitmap.add(i, k << sDegree, prev1);
                }

                if (border >= 3) {
                    next3 = bitmap.get(i, (k + 3) << sDegree);
                }

                for (k = 3; k <= border; k += 2) {
                    prev3 = prev1; prev1 = next1; next1 = next3;
                    next3 = bitmap.get(i, (k + 3) << sDegree);

                    a = prev1 + next1;
                    bitmap.add(i, k << sDegree,
                        ((a << 3) + a - (prev3 + next3) + 8) >> 4
                    );
                }

                for (; k <= kmax; k += 2) {
                    prev1 = next1; next1 = next3; next3 = 0;
                    if (k + 1 <= kmax) {
                        bitmap.add(i, k << sDegree, (prev1 + next1 + 1) >> 1);
                    } else {
                        bitmap.add(i, k << sDegree, prev1);
                    }
                }
            }
        }
    }
}