namespace BimViewer.Models;

/// <summary>One row in the type/color filter panel.</summary>
public class TypeInfo
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public int Count { get; set; }
    public string ColorHex { get; set; } = "#4d84b0";
    public bool Visible { get; set; } = true;
}

/// <summary>One key/value line in the element detail popup.</summary>
public class DetailRow
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

/// <summary>Payload sent from JS when an element is picked in the viewport.</summary>
public class ElementDetail
{
    public string Title { get; set; } = "";
    public string TypeLabel { get; set; } = "";
    public List<DetailRow> Rows { get; set; } = new();
}

/// <summary>Aggregate mesh/vertex/triangle counters shown in the stats grid.</summary>
public class ModelStats
{
    public int Entities { get; set; }
    public int Meshes { get; set; }
    public int Vertices { get; set; }
    public int Triangles { get; set; }
}

public enum LogLevel { Info, Ok, Warn, Err }