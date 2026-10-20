# Interpreting blueprints

Use these meanings when you build from a blueprint and when you propose one. Each entity means the same thing in both cases.

## files

A file is a new file the plan creates. A file that already exists is a pointer, not a file.

## folders

A folder is part of the folder skeleton the plan creates. Each level is its own entry.

## classes

A class is a class the plan adds, in a file. `extends` is its one parent class. `implements` names the interfaces or protocols it fulfills. Its methods are functions with `class` set to its name. Its fields are variables with `class` set to its name. The constructor is one of those functions.

## functions

A function is a function, method, component, or hook the plan adds. A method includes `class`, the class it belongs to. A method that replaces a parent method sets `overrides`.

## variables

A variable is a constant, a piece of shared state, a config value, or a field the plan adds. A field includes `class`, the class it belongs to.

## imports

An import is a relation between two files. `file` is the project path of the file that imports. `from` is the project path of the file that exports the symbol, the same kind of path as `files` and `pointers`, including when the two files are in different folders. `from` is never a symbol name, a package name, or a relative specifier such as `./useAuth` or `msal`. `name` is the imported symbol. One symbol is one entry. Both paths are required.

## notes

A note is an instruction on a file, folder, class, function, or variable. It states the contract or a non-obvious invariant the plan must keep. A note on a method or field includes `class`.

## pointers

A pointer is a reference to a file, folder, class, function, or variable that already exists. Pay attention to it when setting up the plan, and usually edit it. It does not also go in `files`, `folders`, or `classes`. A method or field pointer includes `class`.

## deleted

A deleted entry is an existing file path the plan removes, including its imports, references, and usages.

## steps

A step is a suggested sentence for the plan. Decide which are useful and in what order. Keep, merge, split, reword, reorder, or drop them, and add missing ones. They are suggestions, not the plan itself.
