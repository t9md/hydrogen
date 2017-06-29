let a = [1, 2, 3, 4, 5]

const [ start, ...other] = a
// start
// other
// end
//
// a = "abc"
a.push(4)
a // %%
a.push(5)
// a.push(6)
a.push(7)
a // %%
a.push(8, 9, 10)

a
a.push([])
a

a
a.push("a", "b", "c")
a
