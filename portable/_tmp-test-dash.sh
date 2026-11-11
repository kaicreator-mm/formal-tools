#!/usr/bin/env bash
# inside container: test the exact shim pipeline under dash + inspect shim bytes
printf '3, 14, 0, 1, 0, 0, 0.00%%, 0, 0, 1, 2773.17, 4277, 0, 0, 0\n' > /tmp/pd.csv
echo "--- dash test:"
dash -c 'tail -1 /tmp/pd.csv | cut -d, -f12 | tr -d " "' && echo DASH_OK
echo "--- shim line bytes:"
grep -n "plot_data" /bundle/tools/aflpp/run | head -2
sed -n '/plot_data/p' /bundle/tools/aflpp/run | cat -A | head -2
