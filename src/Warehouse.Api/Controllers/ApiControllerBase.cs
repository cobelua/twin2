namespace Warehouse.Api.Controllers;

using Microsoft.AspNetCore.Mvc;
using Warehouse.Api.Services;

[ApiController]
public abstract class ApiControllerBase : ControllerBase
{
    protected IActionResult ToHttp<T>(ServiceResult<T> result) => result.Error switch
    {
        ServiceError.None => Ok(result.Value),
        ServiceError.NotFound => Problem(result.Message, statusCode: StatusCodes.Status404NotFound),
        ServiceError.Conflict => Problem(result.Message, statusCode: StatusCodes.Status409Conflict),
        _ => Problem(result.Message, statusCode: StatusCodes.Status400BadRequest),
    };
}
