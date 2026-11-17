namespace Warehouse.Api.Services;

public enum ServiceError
{
    None,
    NotFound,
    Invalid,
    Conflict,
}

public record ServiceResult<T>(T? Value, ServiceError Error, string? Message)
{
    public bool IsSuccess => Error == ServiceError.None;

    public static ServiceResult<T> Ok(T value) => new(value, ServiceError.None, null);
    public static ServiceResult<T> Fail(ServiceError error, string message) => new(default, error, message);
}
