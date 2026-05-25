#!/bin/bash
# 下载实验所需数据集
set -e

DATA_DIR="$(dirname "$0")"
mkdir -p "$DATA_DIR/multiwoz" "$DATA_DIR/abcd" "$DATA_DIR/sgd" "$DATA_DIR/kdconv"

echo "=== 1/4 MultiWOZ 2.2 ==="
if [ ! -f "$DATA_DIR/multiwoz/data.json" ]; then
    git clone --depth=1 https://github.com/budzianowski/multiwoz.git "$DATA_DIR/multiwoz_tmp"
    cp -r "$DATA_DIR/multiwoz_tmp/data/MultiWOZ_2.2/"* "$DATA_DIR/multiwoz/"
    rm -rf "$DATA_DIR/multiwoz_tmp"
    echo "  Downloaded MultiWOZ 2.2"
else
    echo "  Already exists, skipping"
fi

echo "=== 2/4 ABCD ==="
if [ ! -f "$DATA_DIR/abcd/abcd_v1.1.json" ]; then
    git clone --depth=1 https://github.com/asappresearch/abcd.git "$DATA_DIR/abcd_tmp"
    cp "$DATA_DIR/abcd_tmp/data/"*.json "$DATA_DIR/abcd/" 2>/dev/null || true
    cp "$DATA_DIR/abcd_tmp/data/"*.jsonl "$DATA_DIR/abcd/" 2>/dev/null || true
    rm -rf "$DATA_DIR/abcd_tmp"
    echo "  Downloaded ABCD"
else
    echo "  Already exists, skipping"
fi

echo "=== 3/4 SGD ==="
if [ ! -f "$DATA_DIR/sgd/train/schema.json" ]; then
    git clone --depth=1 https://github.com/google-research-datasets/dstc8-schema-guided-dialogue.git "$DATA_DIR/sgd_tmp"
    cp -r "$DATA_DIR/sgd_tmp/train" "$DATA_DIR/sgd/"
    cp -r "$DATA_DIR/sgd_tmp/dev" "$DATA_DIR/sgd/"
    cp -r "$DATA_DIR/sgd_tmp/test" "$DATA_DIR/sgd/"
    rm -rf "$DATA_DIR/sgd_tmp"
    echo "  Downloaded SGD"
else
    echo "  Already exists, skipping"
fi

echo "=== 4/4 KdConv ==="
if [ ! -f "$DATA_DIR/kdconv/film/train.json" ]; then
    git clone --depth=1 https://github.com/thu-coai/KdConv.git "$DATA_DIR/kdconv_tmp"
    cp -r "$DATA_DIR/kdconv_tmp/data/"* "$DATA_DIR/kdconv/"
    rm -rf "$DATA_DIR/kdconv_tmp"
    echo "  Downloaded KdConv"
else
    echo "  Already exists, skipping"
fi

echo "=== Done ==="
echo "Datasets saved to: $DATA_DIR"
ls -la "$DATA_DIR"/*/
