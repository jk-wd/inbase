using ExampleCsharp.Store;
using ExampleCsharp.UI;

namespace ExampleCsharp;

public class App
{
    public static void Main(string[] args)
    {
        var store = new TodoStore();
        var page = new TodoPage(store);
        page.Add(args.Length > 0 ? args[0] : "Buy milk");
    }
}
