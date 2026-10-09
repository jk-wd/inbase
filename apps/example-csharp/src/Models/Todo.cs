namespace ExampleCsharp.Models;

public class Todo
{
    public string Title { get; set; } = "";
    public bool Done { get; set; }

    public Todo(string title)
    {
        Title = title;
        Done = false;
    }
}
