namespace Warehouse.Api.Controllers;

using Microsoft.AspNetCore.Mvc;
using Warehouse.Api.Services;
using Warehouse.Api.ViewModels;

[Route("api/rooms")]
public class LayoutController(ILayoutService layout) : ApiControllerBase
{
    [HttpGet]
    public IActionResult GetRooms() => ToHttp(layout.GetRooms());

    [HttpPost]
    public IActionResult CreateRoom(RoomRequest request) => ToHttp(layout.CreateRoom(request));

    [HttpGet("{roomId:int}")]
    public IActionResult GetRoom(int roomId) => ToHttp(layout.GetLayout(roomId));

    [HttpPost("{roomId:int}/layout/validate")]
    public IActionResult ValidateLayout(int roomId, LayoutRequest request) => ToHttp(layout.ValidateLayout(roomId, request));

    [HttpPut("{roomId:int}/layout")]
    public IActionResult SaveLayout(int roomId, LayoutRequest request) => ToHttp(layout.SaveLayout(roomId, request));
}
