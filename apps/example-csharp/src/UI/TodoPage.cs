using ExampleCsharp.Store;

namespace ExampleCsharp.UI;

public class TodoPage
{
    private readonly TodoStore store;

    public TodoPage(TodoStore store)
    {
        this.store = store;
    }

    public void Add(string title)
    {
        store.Add(title);
    }
}
