namespace Warehouse.Api.Controllers;

using Microsoft.AspNetCore.Mvc;
using Warehouse.Api.Services;
using Warehouse.Api.ViewModels;

public class PalletsController(IPalletService pallets) : ApiControllerBase
{
    [HttpGet("api/product-types")]
    public IActionResult GetProductTypes() => ToHttp(pallets.GetProductTypes());

    [HttpPost("api/product-types")]
    public IActionResult CreateProductType(ProductTypeRequest request) => ToHttp(pallets.CreateProductType(request));

    [HttpPost("api/batches/check")]
    public IActionResult CheckBatch(BatchRequest request) => ToHttp(pallets.CheckBatch(request));

    [HttpPost("api/batches")]
    public IActionResult ReceiveBatch(BatchRequest request) => ToHttp(pallets.ReceiveBatch(request));

    [HttpPost("api/rooms/{roomId:int}/batches/{batchId:int}/allocate")]
    public IActionResult Allocate(int roomId, int batchId) => ToHttp(pallets.Allocate(roomId, batchId));

    [HttpPost("api/batches/{batchId:int}/distribute")]
    public IActionResult Distribute(int batchId) => ToHttp(pallets.Distribute(batchId));

    [HttpGet("api/rooms/{roomId:int}/slots")]
    public IActionResult GetSlots(int roomId) => ToHttp(pallets.GetSlots(roomId));

    [HttpPost("api/rooms/{roomId:int}/placements/reset")]
    public IActionResult ResetPlacements(int roomId) => ToHttp(pallets.ResetPlacements(roomId));
}
