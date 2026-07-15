using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using BimViewer;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// Points at the same FastAPI backend the original HTML page used.
builder.Services.AddScoped(sp => new HttpClient
{
    BaseAddress = new Uri("https://ifcjsonbackend.onrender.com/")
});

// https://ifcjsonbackend-production.up.railway.app

await builder.Build().RunAsync();
