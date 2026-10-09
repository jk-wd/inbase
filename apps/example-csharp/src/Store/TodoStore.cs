using System.Collections.Generic;
using ExampleCsharp.Models;

namespace ExampleCsharp.Store;

public class Store
{
    public string Name { get; set; } = "";
}

public class TodoStore : Store
{
    private readonly List<Todo> items = new();
    public string Title { get; set; } = "Todos";

    public TodoStore()
    {
    }

    public void Add(string title)
    {
        items.Add(new Todo(title));
    }

    public int Count => items.Count;
}
