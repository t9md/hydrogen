# string = "Hydrogen"
#
# for index, letter in enumerate(string):
#     print((letter, index))
import sys
import time

for i in range(10):
    sys.stdout.write(str(i))
    time.sleep(1)
    sys.stdout.write("\r")
# print([p for p in
#     [0,1,2,3]])
