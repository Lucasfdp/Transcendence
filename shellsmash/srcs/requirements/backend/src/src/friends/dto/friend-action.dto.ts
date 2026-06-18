import { IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class FriendRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  username: string;
}

export class FriendUserIdDto {
  @IsInt()
  @IsPositive()
  userId: number;
}
